package com.idectl.ide

import com.google.gson.Gson
import com.intellij.mcpserver.McpToolset
import com.intellij.mcpserver.annotations.McpDescription
import com.intellij.mcpserver.annotations.McpTool
import com.intellij.mcpserver.project
import com.intellij.openapi.roots.ProjectRootManager
import com.intellij.openapi.vfs.VfsUtil
import io.flutter.run.daemon.DeviceService
import io.flutter.run.daemon.FlutterApp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.future.await
import kotlinx.coroutines.withContext
import kotlinx.coroutines.currentCoroutineContext

@Suppress("FunctionName", "unused")
class Flutter : McpToolset {
  private fun rows(service: DeviceService) = service.connectedDevices.map {
    mapOf("id" to it.deviceId(), "name" to it.deviceName(), "platform" to it.platform(), "emulator" to it.emulator(), "selected" to (it == service.selectedDevice))
  }

  @McpTool
  @McpDescription("List the devices Flutter run configurations can launch on in this project, and which one is selected.")
  suspend fun idectl_flutter_devices(): String {
    val service = DeviceService.getInstance(currentCoroutineContext().project)
    return Gson().toJson(mapOf("status" to service.status.toString(), "devices" to rows(service)))
  }

  @McpTool
  @McpDescription("Select the device Flutter run configurations launch on. The IDE otherwise uses whatever its toolbar selector holds.")
  suspend fun idectl_flutter_device(@McpDescription("Device id as `flutter devices` prints it, for example emulator-5554") device: String): String {
    val service = DeviceService.getInstance(currentCoroutineContext().project)
    val found = service.connectedDevices.firstOrNull { it.deviceId() == device }
      ?: return Gson().toJson(mapOf("selected" to false, "status" to service.status.toString(), "devices" to rows(service)))
    service.selectedDevice = found
    return Gson().toJson(mapOf("selected" to true, "device" to found.deviceId(), "name" to found.deviceName()))
  }

  @McpTool
  @McpDescription("Hot-reload (or hot-restart) every running Flutter app of this project. Files are re-read from disk first, so edits made outside the IDE are picked up. Breakpoints stay set.")
  suspend fun idectl_flutter_reload(@McpDescription("true for a hot restart (state reset), false for a hot reload (state kept)") restart: Boolean = false): String {
    val project = currentCoroutineContext().project
    // Agents edit files on disk; the IDE compiles from its own file view, so bring that up to date first.
    withContext(Dispatchers.IO) { VfsUtil.markDirtyAndRefresh(false, true, true, *ProjectRootManager.getInstance(project).contentRoots) }
    val apps = FlutterApp.allFromProjectProcess(project).filter { it.isStarted && it.isSessionActive }
    if (apps.isEmpty()) return Gson().toJson(mapOf("reloaded" to false, "error" to "No running Flutter app in this project"))
    val results = apps.map { app ->
      val result = (if (restart) app.performRestartApp("manual") else app.performHotReload(true, "manual")).await()
      mapOf("ok" to result.ok(), "code" to result.code, "message" to result.message)
    }
    return Gson().toJson(mapOf("reloaded" to results.all { it["ok"] == true }, "restart" to restart, "apps" to results))
  }
}
