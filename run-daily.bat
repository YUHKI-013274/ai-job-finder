@echo off
chcp 65001 > nul
rem ????????????45???
timeout /t 45 /nobreak > nul
cd /d "C:\Users\nagam\projects\ai-job-finder"
node run.js >> "C:\Users\nagam\projects\ai-job-finder\logs\run.log" 2>&1
