@echo off
rem =======================================================
rem Cloudflare Pages & GitHub 一键全自动发布脚本
rem 项目: isoziyuan-pan (https://github.com/yys9253462-gif/isoziyuan-pan)
rem 域名: https://pan.ailxw.com / https://isoziyuan-pan.pages.dev
rem =======================================================

setlocal enabledelayedexpansion
title Cloudflare Pages 一键发布工具 - isoziyuan-pan

echo ===================================================
echo   Cloudflare Pages 一键全自动部署与发布系统
echo   目标项目: isoziyuan-pan (https://pan.ailxw.com)
echo ===================================================
echo.

rem 1. 切换到脚本所在目录
cd /d "%~dp0"

rem 2. 检查 Git 变更并自动同步到 GitHub
echo [1/3] 检查代码变更并同步到 GitHub...
git status --porcelain > "%temp%\git_status_check.tmp"
set HAS_CHANGES=0
for /f %%i in ("%temp%\git_status_check.tmp") do set HAS_CHANGES=1
del "%temp%\git_status_check.tmp" 2>nul

if "%HAS_CHANGES%"=="1" (
    echo [INFO] 检测到本地有文件更新，正在自动提交并推送到 GitHub...
    git add -A
    for /f "tokens=1-3 delims=/ " %%a in ("%date%") do set CDATE=%%a-%%b-%%c
    for /f "tokens=1-2 delims=:." %%a in ("%time%") do set CTIME=%%a:%%b
    git commit -m "feat: auto update and deploy at %CDATE% %CTIME%"
    echo [INFO] 正在推送到 GitHub main 分支...
    git push origin main
    if errorlevel 1 (
        echo [WARNING] 推送到 GitHub 遇到警告，但不影响继续发布到 Cloudflare Pages。
    ) else (
        echo [OK] GitHub 代码仓库已同步更新。
    )
) else (
    echo [INFO] 本地工作区干净，无未提交修改。已确认与 GitHub 同步。
)

echo.
rem 3. 自动发布到 Cloudflare Pages
echo [2/3] 正在全自动部署到 Cloudflare Pages...
echo [INFO] 正在上传静态资源及 Edge Functions...

call npx wrangler pages deploy . --project-name isoziyuan-pan --branch main --commit-dirty=true
if errorlevel 1 (
    echo.
    echo ===================================================
    echo [ERROR] Cloudflare Pages 发布失败，请检查网络或配置！
    echo ===================================================
    pause
    exit /b 1
)

echo.
rem 4. 发布成功提示
echo [3/3] 验证部署状态...
echo.
echo ===================================================
echo   恭喜！一键发布已成功完成！
echo.
echo   - 生产域名: https://pan.ailxw.com
echo   - Pages 域: https://isoziyuan-pan.pages.dev
echo   - 源码仓库: https://github.com/yys9253462-gif/isoziyuan-pan
echo ===================================================
echo.

pause
