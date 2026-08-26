use std::{process::{Child, Command, Stdio}, sync::Mutex};
use tauri::{path::BaseDirectory, Manager};

struct LocalServer { port: u16, token: String, child: Mutex<Option<Child>> }

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerInfo { base_url: String, token: String }

#[tauri::command]
fn server_info(state: tauri::State<'_, LocalServer>) -> ServerInfo {
    ServerInfo { base_url: format!("http://127.0.0.1:{}", state.port), token: state.token.clone() }
}

fn main() {
    let port = 3210;
    let token = format!("{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
    let app = tauri::Builder::default()
        .setup(move |app| {
            let server_script = app.path()
                .resolve("backend/index.js", BaseDirectory::Resource)
                .expect("无法定位打包的本地服务");
            let child = Command::new("node")
                .arg(server_script)
                .env("ANTLER_HOST", "127.0.0.1")
                .env("ANTLER_PORT", port.to_string())
                .env("ANTLER_ACCESS_TOKEN", &token)
                .stdin(Stdio::null()).stdout(Stdio::inherit()).stderr(Stdio::inherit())
                .spawn().expect("无法启动 Node.js 本地伴生服务");
            app.manage(LocalServer { port, token, child: Mutex::new(Some(child)) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![server_info])
        .build(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
            if let Some(mut child) = app_handle.state::<LocalServer>().child.lock().expect("服务进程锁已中毒").take() {
                let _ = child.kill();
            }
        }
    });
}
