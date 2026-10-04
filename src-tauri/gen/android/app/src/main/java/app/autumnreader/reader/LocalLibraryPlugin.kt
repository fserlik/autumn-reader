package app.autumnreader.reader

import android.app.Activity
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.util.concurrent.Executors
import java.util.Locale
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

@InvokeArg
class NativeBookArgs { lateinit var record: String }
@InvokeArg
class NativeBookIdArgs { lateinit var id: String }
@InvokeArg
class NativeTtsSpeakArgs {
  lateinit var text: String
  var voiceUri: String = ""
  var language: String = ""
  var rate: Double = 1.0
}

private data class PendingTtsInitialization(
  val invoke: Invoke,
  val action: (TextToSpeech) -> Unit,
)

private data class ActiveSpeech(
  val invoke: Invoke,
  val text: String,
  val voiceUri: String,
  val language: String,
  val rate: Float,
  var utteranceId: String,
)

@TauriPlugin
class LocalLibraryPlugin(private val activity: Activity) : Plugin(activity), TextToSpeech.OnInitListener {
  // Historical directory: renaming it would hide existing books from their owners.
  private val library by lazy { NativeLibrary(File(activity.filesDir, "drive-library")) }
  private val libraryExecutor = Executors.newSingleThreadExecutor()
  private val ttsLock = Any()
  private var tts: TextToSpeech? = null
  private var ttsReady = false
  private var ttsFailed = false
  private var ttsPaused = false
  private var activeSpeech: ActiveSpeech? = null
  private val pendingTtsInitialization = mutableListOf<PendingTtsInitialization>()

  init {
    activity.runOnUiThread { tts = TextToSpeech(activity.applicationContext, this) }
  }

  override fun onInit(status: Int) {
    val engine = tts
    val pending: List<PendingTtsInitialization>
    synchronized(ttsLock) {
      ttsReady = status == TextToSpeech.SUCCESS && engine != null
      ttsFailed = !ttsReady
      pending = pendingTtsInitialization.toList()
      pendingTtsInitialization.clear()
    }
    if (!ttsReady || engine == null) {
      pending.forEach { it.invoke.reject("TTS_INITIALIZATION_FAILED") }
      return
    }
    engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String) = Unit
      override fun onDone(utteranceId: String) = finishSpeech(utteranceId, "done")
      @Deprecated("Deprecated by Android")
      override fun onError(utteranceId: String) = failSpeech(utteranceId)
      override fun onError(utteranceId: String, errorCode: Int) = failSpeech(utteranceId)
      override fun onStop(utteranceId: String, interrupted: Boolean) {
        val shouldResolve = synchronized(ttsLock) {
          activeSpeech?.utteranceId == utteranceId && !ttsPaused
        }
        if (shouldResolve) finishSpeech(utteranceId, "stopped")
      }
    })
    pending.forEach { queued -> activity.runOnUiThread { queued.action(engine) } }
  }

  override fun onDestroy(activity: AppCompatActivity) {
    val (active, pending) = synchronized(ttsLock) {
      val current = activeSpeech
      val queued = pendingTtsInitialization.toList()
      activeSpeech = null
      pendingTtsInitialization.clear()
      ttsPaused = false
      ttsReady = false
      ttsFailed = true
      current to queued
    }
    active?.invoke?.resolve(statusResult("stopped"))
    pending.forEach { it.invoke.reject("TTS_STOPPED") }
    tts?.stop()
    tts?.shutdown()
    tts = null
    super.onDestroy(activity)
  }

  private fun withTts(invoke: Invoke, action: (TextToSpeech) -> Unit) {
    val engine: TextToSpeech?
    val failed: Boolean
    synchronized(ttsLock) {
      engine = if (ttsReady) tts else null
      failed = ttsFailed
      if (engine == null && !failed) pendingTtsInitialization.add(PendingTtsInitialization(invoke, action))
    }
    when {
      failed -> invoke.reject("TTS_INITIALIZATION_FAILED")
      engine != null -> activity.runOnUiThread { action(engine) }
    }
  }

  private fun statusResult(status: String) = JSObject().apply { put("status", status) }

  private fun languageTag(voice: Voice): String {
    val match = Regex("^([A-Za-z]{2,3})[-_]([A-Za-z]{2})").find(voice.name)
    return if (match != null) {
      "${match.groupValues[1].lowercase(Locale.ROOT)}-${match.groupValues[2].uppercase(Locale.ROOT)}"
    } else voice.locale.toLanguageTag()
  }

  private fun finishSpeech(utteranceId: String, status: String) {
    val completed = synchronized(ttsLock) {
      activeSpeech?.takeIf { it.utteranceId == utteranceId }?.also {
        activeSpeech = null
        ttsPaused = false
      }
    }
    completed?.invoke?.resolve(statusResult(status))
  }

  private fun failSpeech(utteranceId: String) {
    val failed = synchronized(ttsLock) {
      activeSpeech?.takeIf { it.utteranceId == utteranceId }?.also {
        activeSpeech = null
        ttsPaused = false
      }
    }
    failed?.invoke?.reject("TTS_PLAYBACK_FAILED")
  }

  private fun configureSpeech(engine: TextToSpeech, speech: ActiveSpeech): Boolean {
    if (engine.setSpeechRate(speech.rate.coerceIn(0.5f, 2.0f)) == TextToSpeech.ERROR) return false
    val selected = engine.voices?.firstOrNull { it.name == speech.voiceUri }
    if (selected != null) return engine.setVoice(selected) != TextToSpeech.ERROR
    if (speech.language.isNotBlank()) {
      val availability = engine.setLanguage(Locale.forLanguageTag(speech.language))
      if (availability == TextToSpeech.LANG_MISSING_DATA || availability == TextToSpeech.LANG_NOT_SUPPORTED) return false
    }
    return true
  }

  private fun speak(engine: TextToSpeech, speech: ActiveSpeech) {
    if (!configureSpeech(engine, speech)) {
      failSpeech(speech.utteranceId)
      return
    }
    val queued = engine.speak(speech.text, TextToSpeech.QUEUE_FLUSH, null, speech.utteranceId)
    if (queued == TextToSpeech.ERROR) failSpeech(speech.utteranceId)
  }

  @Command
  fun nativeListBooks(invoke: Invoke) {
    libraryExecutor.execute {
      try { invoke.resolve(JSObject().apply { put("books", library.list()) }) }
      catch (error: Exception) { invoke.reject("LOCAL_LIBRARY_ERROR:library_read_failed") }
    }
  }

  @Command
  fun nativeSaveBook(invoke: Invoke) {
    val args = invoke.parseArgs(NativeBookArgs::class.java)
    libraryExecutor.execute {
      try { library.save(JSONObject(args.record)); invoke.resolve(JSObject()) }
      catch (error: Exception) { invoke.reject(error.message ?: "LOCAL_LIBRARY_ERROR:library_save_failed") }
    }
  }

  @Command
  fun nativeDeleteBook(invoke: Invoke) {
    val args = invoke.parseArgs(NativeBookIdArgs::class.java)
    libraryExecutor.execute {
      try { library.delete(args.id); invoke.resolve(JSObject()) }
      catch (error: Exception) { invoke.reject("LOCAL_LIBRARY_ERROR:library_save_failed") }
    }
  }

  @Command
  fun nativeTtsVoices(invoke: Invoke) = withTts(invoke) { engine ->
    val all = engine.voices?.toList().orEmpty()
    val local = all.filterNot { it.isNetworkConnectionRequired }
    val available = (if (local.isNotEmpty()) local else all).sortedWith(
      compareByDescending<Voice> { it.name == engine.voice?.name }
        .thenBy { languageTag(it) }
        .thenBy { it.name }
    )
    val voices = JSONArray()
    available.forEach { voice ->
      voices.put(JSONObject().apply {
        put("voiceURI", voice.name)
        put("name", voice.name)
        put("lang", languageTag(voice))
        put("localService", !voice.isNetworkConnectionRequired)
        put("default", voice.name == engine.voice?.name)
      })
    }
    invoke.resolve(JSObject().apply { put("voices", voices) })
  }

  @Command
  fun nativeTtsSpeak(invoke: Invoke) {
    val args = invoke.parseArgs(NativeTtsSpeakArgs::class.java)
    withTts(invoke) { engine ->
      val previous = synchronized(ttsLock) {
        activeSpeech.also {
          activeSpeech = null
          ttsPaused = false
        }
      }
      previous?.invoke?.resolve(statusResult("stopped"))
      engine.stop()
      val speech = ActiveSpeech(
        invoke = invoke,
        text = args.text,
        voiceUri = args.voiceUri,
        language = args.language,
        rate = args.rate.toFloat(),
        utteranceId = UUID.randomUUID().toString(),
      )
      synchronized(ttsLock) { activeSpeech = speech }
      speak(engine, speech)
    }
  }

  @Command
  fun nativeTtsPause(invoke: Invoke) = withTts(invoke) { engine ->
    val shouldPause = synchronized(ttsLock) {
      if (activeSpeech != null && !ttsPaused) { ttsPaused = true; true } else false
    }
    if (shouldPause) engine.stop()
    invoke.resolve(JSObject())
  }

  @Command
  fun nativeTtsResume(invoke: Invoke) = withTts(invoke) { engine ->
    val speech = synchronized(ttsLock) {
      activeSpeech?.takeIf { ttsPaused }?.also {
        ttsPaused = false
        it.utteranceId = UUID.randomUUID().toString()
      }
    }
    if (speech != null) speak(engine, speech)
    invoke.resolve(JSObject())
  }

  @Command
  fun nativeTtsStop(invoke: Invoke) = withTts(invoke) { engine ->
    val stopped = synchronized(ttsLock) {
      activeSpeech.also {
        activeSpeech = null
        ttsPaused = false
      }
    }
    engine.stop()
    stopped?.invoke?.resolve(statusResult("stopped"))
    invoke.resolve(JSObject())
  }

}
