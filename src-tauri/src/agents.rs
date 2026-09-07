//! Agent CLIs the terminal pane can open into — see `cortex_core::agents`.
//! Detection lives in core so `cortex agents` and the MCP `list_agents` tool
//! report exactly what the settings dropdown offers.

use cortex_core::agents::{self, AgentCli};

/// Every known agent CLI, with whether it is installed and where.
#[tauri::command]
pub fn detect_agents() -> Vec<AgentCli> {
    agents::detect()
}
