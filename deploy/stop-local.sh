#!/bin/bash
# Stops everything deploy/start-local.sh started: whatever listens on the
# app's ports, plus the ngrok agent. (Windows processes don't reliably die
# with the shell that started them, so stop them by port.)
powershell.exe -NoProfile -Command '
  foreach ($port in 7860, 5001, 4000, 3000) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  }
  Get-Process ngrok, caddy -ErrorAction SilentlyContinue | Stop-Process -Force
  Write-Output "Stopped."
'
