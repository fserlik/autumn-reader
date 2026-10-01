package app.autumnreader.reader

import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Compatibility adapter for books already stored in private app files. */
class NativeLibrary(private val root: File) {
  companion object {
    private val lock = Any()
    private val idPattern = Regex("[a-zA-Z0-9-]{1,80}")
    private val colors = setOf("#cc5500", "#8b0000", "#996515", "#808000", "#b7410e", "#800020")
  }

  private fun index(): JSONArray {
    val file = AtomicFile(File(root, "index.json"))
    return if (file.baseFile.exists() || File(root, "index.json.bak").exists()) {
      JSONArray(file.openRead().bufferedReader().use { it.readText() })
    } else JSONArray()
  }

  private fun writeIndex(records: Collection<JSONObject>) {
    root.mkdirs()
    val file = AtomicFile(File(root, "index.json"))
    val stream = file.startWrite()
    try {
      stream.write(JSONArray(records).toString().toByteArray(Charsets.UTF_8))
      file.finishWrite(stream)
    } catch (error: Exception) {
      file.failWrite(stream)
      throw error
    }
  }

  fun list(): JSONArray = synchronized(lock) {
    val records = index()
    JSONArray().apply {
      for (i in 0 until records.length()) {
        val record = JSONObject(records.getJSONObject(i).toString())
        val path = "${record.getString("generation")}/${record.getString("id")}"
        val data = File(root, "objects/$path/data.bin")
        if (!data.isFile) continue
        record.put("nativeDataPath", "$path/data.bin")
        record.put("nativeDataSize", data.length())
        if (record.optBoolean("hasCover")) {
          val cover = File(root, "objects/$path/cover.bin")
          if (cover.isFile) {
            record.put("nativeCoverPath", "$path/cover.bin")
            record.put("nativeCoverSize", cover.length())
          }
        }
        put(record)
      }
    }
  }

  fun save(metadata: JSONObject) = synchronized(lock) {
    validateRecord(metadata)
    val records = index()
    var found = false
    val updated = (0 until records.length()).map { i ->
      val existing = records.getJSONObject(i)
      if (existing.getString("id") == metadata.getString("id")) {
        found = true
        cleanRecord(metadata).put("generation", existing.getString("generation"))
          .put("hasCover", existing.optBoolean("hasCover"))
      } else existing
    }
    check(found) { "LOCAL_LIBRARY_ERROR:book_missing" }
    writeIndex(updated)
  }

  fun delete(id: String) = synchronized(lock) {
    require(idPattern.matches(id))
    val records = index()
    val remaining = (0 until records.length()).map { records.getJSONObject(it) }
      .filter { it.getString("id") != id }
    writeIndex(remaining)
    cleanUnused(remaining)
  }

  private fun cleanUnused(records: Collection<JSONObject>) {
    val paths = records.map { "${it.getString("generation")}/${it.getString("id")}" }.toSet()
    File(root, "objects").listFiles()?.forEach { generation ->
      generation.listFiles()?.forEach { book ->
        if ("${generation.name}/${book.name}" !in paths) book.deleteRecursively()
      }
      if (generation.listFiles()?.isEmpty() == true) generation.delete()
    }
  }

  private fun cleanRecord(record: JSONObject): JSONObject = JSONObject().apply {
    for (key in listOf("id", "name", "format", "addedAt", "lastOpenedAt", "favorite", "page", "cfi", "fontSize", "pdfTextOffset", "hasCover", "notes")) {
      if (record.has(key)) put(key, record.get(key))
    }
  }

  private fun validateRecord(record: JSONObject) {
    fun number(key: String) = (record.opt(key) as? Number)?.toDouble() ?: Double.NaN
    val format = record.optString("format")
    val page = number("page")
    val cfi = record.opt("cfi")
    require(record.opt("id") is String && idPattern.matches(record.optString("id"))
      && record.opt("name") is String && record.optString("name").length in 1..500
      && record.opt("format") is String && format in setOf("pdf", "epub") && number("addedAt").isFinite() && number("lastOpenedAt").isFinite()
      && record.opt("favorite") is Boolean && page >= 1 && page % 1 == 0.0
      && (cfi == JSONObject.NULL || cfi is String) && number("fontSize") in 70.0..180.0
      && record.opt("hasCover") is Boolean) { "LOCAL_LIBRARY_ERROR:invalid_book" }
    if (record.has("pdfTextOffset")) require(number("pdfTextOffset") in 0.0..1.0) { "LOCAL_LIBRARY_ERROR:invalid_book" }
    if (!record.has("notes")) return
    val notes = record.optJSONArray("notes") ?: error("LOCAL_LIBRARY_ERROR:invalid_notes")
    require(notes.length() <= 1000) { "LOCAL_LIBRARY_ERROR:invalid_notes" }
    for (i in 0 until notes.length()) {
      val note = notes.getJSONObject(i)
      val notePage = note.optDouble("page", Double.NaN)
      require(note.opt("id") is String && idPattern.matches(note.optString("id"))
        && note.opt("quote") is String && note.optString("quote").length in 1..500
        && note.opt("text") is String && note.optString("text").length in 1..5000
        && note.opt("color") is String && note.optString("color") in colors
        && (note.opt("createdAt") as? Number)?.toDouble()?.isFinite() == true
        && note.optString("format") == format
        && if (format == "pdf") note.opt("page") is Number && note.opt("y") is Number && notePage >= 1 && notePage % 1 == 0.0 && note.optDouble("y", Double.NaN) in 0.0..1.0
           else note.opt("cfi") is String && note.optString("cfi").startsWith("epubcfi(") && note.optString("cfi").length <= 2000
      ) { "LOCAL_LIBRARY_ERROR:invalid_notes" }
    }
  }
}
