@echo off
setlocal

pushd "%~dp0.."
if errorlevel 1 exit /b %errorlevel%

if not exist "node_modules\.bin\tsc.cmd" (
  echo Restoring lockfile-pinned desktop dependencies...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    popd
    exit /b %errorlevel%
  )
)

call npm run build
set "BUILD_RESULT=%errorlevel%"
popd
exit /b %BUILD_RESULT%
