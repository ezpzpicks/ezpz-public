from pathlib import Path
import runpy

runpy.run_path("scripts/fix_full_slate_mlb_parity.py", run_name="__main__")

path = Path("app/FootballBoardLegacy.tsx")
source = path.read_text()
broken = ';\n  }\n  } else {\n    const trackerRows = data.betTrackerRows || [];'
fixed = ';\n  } else {\n    const trackerRows = data.betTrackerRows || [];'
if broken not in source:
    raise SystemExit("Expected Full Slate branch boundary was not found after patching.")
path.write_text(source.replace(broken, fixed, 1))
print("Corrected Full Slate branch boundary.")
