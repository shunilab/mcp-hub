use std::process::Command;

#[tauri::command]
fn run_cli(args: Vec<String>) -> Result<String, String> {
    let node = find_node().ok_or("node not found. Install Node.js first.")?;
    let cli = find_cli().ok_or(
        "mcp-hub CLI not found. Ensure packages/cli is built and accessible."
    )?;

    let output = Command::new(&node)
        .arg(&cli)
        .args(&args)
        // Expand PATH so node can find npx etc.
        .env("PATH", expanded_path())
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

fn expanded_path() -> String {
    let system_path = std::env::var("PATH").unwrap_or_default();
    // Prepend common homebrew/nvm/fnm paths so they're found even in Tauri's restricted env
    let extras = [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
    ];
    let extra = extras.join(":");
    if system_path.is_empty() {
        extra
    } else {
        format!("{extra}:{system_path}")
    }
}

fn find_node() -> Option<String> {
    let candidates = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ];
    for c in candidates {
        if std::path::Path::new(c).exists() {
            return Some(c.to_string());
        }
    }
    // Try resolving via shell
    if let Ok(out) = Command::new("sh")
        .args(["-c", "command -v node"])
        .env("PATH", expanded_path())
        .output()
    {
        let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !p.is_empty() {
            return Some(p);
        }
    }
    None
}

fn find_cli() -> Option<String> {
    // 1. Env var override
    if let Ok(path) = std::env::var("MCP_HUB_CLI") {
        if std::path::Path::new(&path).exists() {
            return Some(path);
        }
    }

    // 2. Dev mode: resolve workspace root from executable path
    //    exe: .../packages/app/src-tauri/target/debug/mcp-hub-app  (6 parents to workspace root)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(root) = exe
            .parent()  // debug/
            .and_then(|p| p.parent())  // target/
            .and_then(|p| p.parent())  // src-tauri/
            .and_then(|p| p.parent())  // app/
            .and_then(|p| p.parent())  // packages/
            .and_then(|p| p.parent())  // workspace root (mcp-hub/)
        {
            let cli = root.join("packages/cli/dist/index.js");
            if cli.exists() {
                return Some(cli.to_string_lossy().to_string());
            }
        }
    }

    // 3. Home dir fallback
    if let Some(home) = dirs::home_dir() {
        let cli = home.join(".mcp-hub/cli/index.js");
        if cli.exists() {
            return Some(cli.to_string_lossy().to_string());
        }
    }

    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![run_cli])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
