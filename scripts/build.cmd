@echo off
node "%~dp0build\native-build.mjs" --preset windows-msvc --fresh %*
