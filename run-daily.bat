@echo off
chcp 65001 > nul
cd /d "C:\Users\nagam\projects\ai-job-finder"
node run.js >> "C:\Users\nagam\projects\ai-job-finder\logs\run.log" 2>&1
