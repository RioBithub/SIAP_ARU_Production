@echo off
title SIAP ARU - Setup Local
echo ==========================================
echo SIAP ARU - Setup Local Windows
echo ==========================================
echo.
echo Paket v1.6 tidak menyertakan .env.local.
echo Gunakan .env.local project Anda yang sudah benar.
echo.
echo Pastikan MySQL/XAMPP sudah berjalan.
echo Database default SIAP: aru_siap
echo.
pause
call npm install
if errorlevel 1 goto :error
echo.
echo Menjalankan SIAP ARU...
call npm run dev
goto :eof
:error
echo.
echo Setup gagal. Cek pesan error di atas.
pause
