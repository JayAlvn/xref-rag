import argparse
import csv
import json
import subprocess
import urllib.request

from datetime import datetime
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
QUESTIONS = EVAL_DIR / "questions.csv"
RESULTS = EVAL_DIR / "results"


def read_questions(path):
    with open(path, newline="", encoding="utf-8") as file:
        return list(csv.DictReader(file))

def ask(url, question, document):
    body = json.dumps(
        {"query": question,
        "source": document,
        }
    ).encode("utf-8")

    request = urllib.request.Request(
        url + "/query",
        data=body, #signals request is a POST method.
        headers={"Content-Type":"application/json"}
    )
    with urllib.request.urlopen(request, timeout=900) as response:
        return json.loads(response.read())

def current_commit():
    result = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        capture_output=True,
        text=True,
        cwd=EVAL_DIR,
    )

    return result.stdout.strip()

def save_config(folder, args):
    config = {
        "name": args.name,
        "model":args.model,
        "runs": args.runs,
        "commit": current_commit(),
        "started": datetime.now().isoformat(timespec="seconds"),
    }
    (folder / "config.json").write_text(json.dumps(config, indent=2))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("name")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--model", default="llama3.2")
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    
    args = parser.parse_args()

    folder = RESULTS / args.name
    folder.mkdir(parents=True, exist_ok=True)
    save_config(folder, args)

    questions = read_questions(QUESTIONS)
    
    for run in range(1, args.runs + 1):
        for row in questions:
            path = folder / f"{row['id']}_run{run}.json"
            if path.exists():
                continue
            print(f"run {run}  {row['id']}")

            try:
                answer = ask(args.url, row["question"], row["document"])
            except Exception as error:
                print(f"  failed: {error}")
                continue
            path.write_text(json.dumps(answer, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()