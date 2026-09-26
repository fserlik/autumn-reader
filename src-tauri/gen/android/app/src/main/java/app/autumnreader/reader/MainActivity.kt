package app.autumnreader.reader

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightStatusBars = false
  }
}
