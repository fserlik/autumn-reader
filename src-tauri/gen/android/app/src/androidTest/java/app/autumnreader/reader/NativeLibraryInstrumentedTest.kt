package app.autumnreader.reader

import android.content.Intent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.CountDownLatch

class NativeLibraryInstrumentedTest {
  @Test
  fun readsNativeBookFilesThroughTheWebViewProtocol() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    val generation = "protocol-${UUID.randomUUID()}"
    val fixture = File(context.filesDir, "drive-library/objects/$generation/test-book").apply { mkdirs() }
    File(fixture, "data.bin").writeText("autumn-native-reader")
    try {
      context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      fun find(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) for (i in 0 until view.childCount) find(view.getChildAt(i))?.let { return it }
        return null
      }
      fun evaluate(script: String): String? {
        var result: String? = null
        val latch = CountDownLatch(1)
        instrumentation.runOnMainSync {
          val activity = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED)
            .firstOrNull { it is MainActivity }
          val webview = activity?.let { find(it.window.decorView) }
          if (webview == null) latch.countDown()
          else webview.evaluateJavascript(script) { result = it; latch.countDown() }
        }
        latch.await(3, TimeUnit.SECONDS)
        return result
      }
      val deadline = System.currentTimeMillis() + 20000
      while (evaluate("typeof window.__TAURI_INTERNALS__") != "\"object\"" && System.currentTimeMillis() < deadline) Thread.sleep(250)
      evaluate("window.__nativeProtocolResult=null; fetch(window.__TAURI_INTERNALS__.convertFileSrc('$generation/test-book/data.bin', 'book-file')).then(r => { if (!r.ok) throw new Error('HTTP '+r.status); return r.text(); }).then(t => window.__nativeProtocolResult=t).catch(e => window.__nativeProtocolResult='ERROR:'+e.message)")
      var result: String? = null
      while (System.currentTimeMillis() < deadline) {
        result = evaluate("window.__nativeProtocolResult")
        if (result != null && result != "null") break
        Thread.sleep(250)
      }
      assertEquals("\"autumn-native-reader\"", result)
    } finally { fixture.parentFile?.deleteRecursively() }
  }

  private fun record(id: String) = JSONObject()
    .put("id", id).put("name", "$id.pdf").put("format", "pdf")
    .put("addedAt", 1).put("lastOpenedAt", 1).put("favorite", false)
    .put("page", 1).put("cfi", JSONObject.NULL).put("fontSize", 100).put("hasCover", false)
    .put("notes", JSONArray().put(JSONObject().put("id", "note-1").put("quote", "passage")
      .put("text", "Keep this note").put("color", "#cc5500").put("createdAt", 1)
      .put("format", "pdf").put("page", 1).put("y", 0.2)))

  @Test
  fun preservesLegacyFilesNotesAndMetadata() {
    val root = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "library-test-${UUID.randomUUID()}").apply { mkdirs() }
    try {
      val id = "legacy-book"
      val original = record(id).put("generation", "legacy-generation")
      val data = File(root, "objects/legacy-generation/$id/data.bin")
      data.parentFile?.mkdirs()
      data.writeText("legacy-file")
      File(root, "index.json").writeText(JSONArray().put(original).toString())
      val library = NativeLibrary(root)
      val saved = library.list().getJSONObject(0)
      assertEquals("Keep this note", saved.getJSONArray("notes").getJSONObject(0).getString("text"))
      saved.put("page", 7).put("favorite", true)
        .put("ownerId", "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa")
      library.save(saved)
      val reopened = NativeLibrary(root).list().getJSONObject(0)
      assertEquals(7, reopened.getInt("page"))
      assertTrue(reopened.getBoolean("favorite"))
      assertEquals("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", reopened.getString("ownerId"))
      assertEquals("legacy-file", data.readText())
      library.delete(id)
      assertEquals(0, library.list().length())
    } finally { root.deleteRecursively() }
  }
}
