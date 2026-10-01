package app.autumnreader.reader

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.util.concurrent.Executors
import org.json.JSONObject

@InvokeArg
class NativeBookArgs { lateinit var record: String }
@InvokeArg
class NativeBookIdArgs { lateinit var id: String }

@TauriPlugin
class LocalLibraryPlugin(private val activity: Activity) : Plugin(activity) {
  // Historical directory: renaming it would hide existing books from their owners.
  private val library by lazy { NativeLibrary(File(activity.filesDir, "drive-library")) }
  private val libraryExecutor = Executors.newSingleThreadExecutor()

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

}
