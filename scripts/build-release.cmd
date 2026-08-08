@echo off
setlocal EnableExtensions

pushd "%~dp0.."
if errorlevel 1 exit /b %errorlevel%

if /I "%~1"=="--help" goto :usage
if /I "%~1"=="/?" goto :usage

echo ============================================================
echo  Ballistics Workbench - Windows x64 release build
echo ============================================================
echo.

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" (
  echo ERROR: Visual Studio Installer could not be found.
  echo Install Visual Studio with the Desktop development with C++ workload.
  goto :failed
)

set "VS_INSTALL="
for /f "usebackq tokens=*" %%I in (`"%VSWHERE%" -latest -products * -property installationPath`) do set "VS_INSTALL=%%I"
if not defined VS_INSTALL (
  echo ERROR: A Visual Studio installation could not be found.
  goto :failed
)

echo [1/6] Loading the Visual Studio x64 build environment...
call "%VS_INSTALL%\Common7\Tools\VsDevCmd.bat" -arch=x64 -host_arch=x64
if errorlevel 1 goto :failed

where cl.exe >nul 2>nul
if errorlevel 1 (
  echo ERROR: The Visual Studio x64 C++ compiler is not installed.
  echo Add the Desktop development with C++ workload in Visual Studio Installer.
  goto :failed
)

where msbuild.exe >nul 2>nul
if errorlevel 1 (
  echo ERROR: MSBuild was not added to the build environment.
  goto :failed
)

where node.exe >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js 22 or later is required and was not found on PATH.
  goto :failed
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm was not found on PATH.
  goto :failed
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
  echo ERROR: Node.js 22 or later is required.
  node --version
  goto :failed
)

if not exist "node_modules\.bin\electron-builder.cmd" (
  echo [2/6] Restoring lockfile-pinned desktop dependencies...
  call npm ci --no-audit --no-fund
  if errorlevel 1 goto :failed
) else (
  echo [2/6] Desktop dependencies are already installed.
)

echo [3/6] Building the Visual Studio solution in Release x64...
msbuild "BallisticsWorkbench.sln" /m /t:Build /p:Configuration=Release /p:Platform=x64 /v:minimal
if errorlevel 1 goto :failed

echo [4/6] Running the native regression tests...
if not exist "x64\Release\Ballistics.Core.Tests.exe" (
  echo ERROR: The native test executable was not produced.
  goto :failed
)
"x64\Release\Ballistics.Core.Tests.exe"
if errorlevel 1 goto :failed

echo [5/6] Running the renderer unit tests...
call npm test
if errorlevel 1 goto :failed

for /f "usebackq delims=" %%V in (`node -p "require('./package.json').version"`) do set "APP_VERSION=%%V"
set "PACKAGE_STAGE=%TEMP%\BallisticsWorkbench-release-%APP_VERSION%"
set "STAGED_INSTALLER=%PACKAGE_STAGE%\Ballistics-Workbench-%APP_VERSION%-Setup.exe"
set "STAGED_UNPACKED=%PACKAGE_STAGE%\win-unpacked"
set "INSTALLER=%CD%\outputs\installer\Ballistics-Workbench-%APP_VERSION%-Setup.exe"
set "UNPACKED_EXE=%CD%\outputs\installer\win-unpacked\Ballistics Workbench.exe"

echo [6/6] Creating the Windows installer...
call :clean_package_stage
if errorlevel 1 goto :failed

call npx --no-install electron-builder --win nsis --config.directories.output="%PACKAGE_STAGE%"
if errorlevel 1 goto :failed

if not exist "%STAGED_INSTALLER%" (
  echo ERROR: Packaging completed, but the staged installer was not found:
  echo   %STAGED_INSTALLER%
  goto :failed
)

if not exist "outputs\installer" mkdir "outputs\installer"
if errorlevel 1 goto :failed

if exist "outputs\installer\win-unpacked.tmp" rmdir /s /q "outputs\installer\win-unpacked.tmp"

robocopy "%STAGED_UNPACKED%" "outputs\installer\win-unpacked" /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
if errorlevel 8 (
  echo ERROR: Could not update outputs\installer\win-unpacked.
  echo Close any running Ballistics Workbench window and try again.
  goto :failed
)

copy /Y "%STAGED_INSTALLER%" "outputs\installer\" >nul
if errorlevel 1 goto :failed
if exist "%STAGED_INSTALLER%.blockmap" copy /Y "%STAGED_INSTALLER%.blockmap" "outputs\installer\" >nul

call :clean_package_stage

if not exist "%INSTALLER%" (
  echo ERROR: Packaging completed, but the expected installer was not found:
  echo   %INSTALLER%
  goto :failed
)

echo.
echo ============================================================
echo  Release build completed successfully.
echo ============================================================
echo Installer:
echo   %INSTALLER%
if exist "%UNPACKED_EXE%" (
  echo Direct executable:
  echo   %UNPACKED_EXE%
)
echo.

if /I "%~1"=="--run" (
  if exist "%UNPACKED_EXE%" (
    echo Launching Ballistics Workbench...
    start "" "%UNPACKED_EXE%"
  ) else (
    echo The unpacked executable was not found; run the installer shown above.
  )
)

popd
exit /b 0

:clean_package_stage
if exist "%PACKAGE_STAGE%" rmdir /s /q "%PACKAGE_STAGE%"
if exist "%PACKAGE_STAGE%" (
  echo ERROR: Could not clean the temporary packaging directory:
  echo   %PACKAGE_STAGE%
  exit /b 1
)
exit /b 0

:usage
echo Usage: scripts\build-release.cmd [--run]
echo.
echo   With no option, builds and tests the x64 release and creates the installer.
echo   --run also launches the unpacked application after a successful build.
popd
exit /b 0

:failed
set "BUILD_EXIT=%errorlevel%"
if "%BUILD_EXIT%"=="0" set "BUILD_EXIT=1"
echo.
echo RELEASE BUILD FAILED with exit code %BUILD_EXIT%.
popd
exit /b %BUILD_EXIT%
