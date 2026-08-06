@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "CLANG_FORMAT="
for /f "delims=" %%F in ('where clang-format.exe 2^>nul') do if not defined CLANG_FORMAT set "CLANG_FORMAT=%%F"

if not defined CLANG_FORMAT (
  set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
  if exist "!VSWHERE!" (
    for /f "usebackq tokens=*" %%I in (`"!VSWHERE!" -latest -products * -property installationPath`) do set "VS_INSTALL=%%I"
    if defined VS_INSTALL set "CLANG_FORMAT=!VS_INSTALL!\VC\Tools\Llvm\x64\bin\clang-format.exe"
  )
)

if not exist "%CLANG_FORMAT%" (
  echo clang-format was not found. Install the LLVM tools component in Visual Studio.
  exit /b 1
)

for /r "%~dp0..\src" %%F in (*.cpp *.hpp) do "%CLANG_FORMAT%" --dry-run --Werror --style=file "%%F"
if errorlevel 1 exit /b %errorlevel%

for /r "%~dp0..\tests" %%F in (*.cpp *.hpp) do "%CLANG_FORMAT%" --dry-run --Werror --style=file "%%F"
if errorlevel 1 exit /b %errorlevel%

call npm exec prettier -- --check "src/Ballistics.Desktop/**/*.{ts,tsx,cjs,css,json}" "vite.config.ts" "index.html" "README.md" "CHANGELOG.md" "docs/**/*.md" ".github/**/*.{yml,yaml}" "*.json"
if errorlevel 1 exit /b %errorlevel%

call npm exec prettier -- --check --parser html "assets/**/*.svg"
exit /b %errorlevel%
