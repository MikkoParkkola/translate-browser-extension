#!/bin/bash
# spark-monitor.sh
# Monitor TranslateGemma conversion progress
#
# Usage: ./spark-monitor.sh

LOG_FILE="$HOME/translategemma-conversion.log"
SESSION_NAME="translategemma"

echo "TranslateGemma Conversion Monitor"
echo "================================="
echo ""

# Check if conversion is running
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "Status: RUNNING in tmux session '$SESSION_NAME'"
    echo ""
    echo "Commands:"
    echo "  Attach to session:  tmux attach -t $SESSION_NAME"
    echo "  Kill conversion:    tmux kill-session -t $SESSION_NAME"
else
    echo "Status: NOT RUNNING"
    echo ""
    echo "To start: ./spark-convert-translategemma.sh"
fi

echo ""
echo "Last 20 log lines:"
echo "-------------------"

if [ -f "$LOG_FILE" ]; then
    tail -20 "$LOG_FILE"
else
    echo "(No log file found)"
fi

echo ""
echo "-------------------"
echo "Live tail: tail -f $LOG_FILE"
