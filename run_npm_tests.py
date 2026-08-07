import subprocess, os

# Define paths
project_root = r"C:\Users\parth\OneDrive - Monash University\Personal\Projects\crosspaste"
output_file = os.path.join(project_root, "docs", "integration-test-report.txt")

# Run npm test capturing stdout and stderr
result = subprocess.run(["npm","test"], cwd=project_root, capture_output=True, text=True)
with open(output_file,'w',encoding='utf-8') as f:
    f.write(result.stdout + "\n" + result.stderr)
