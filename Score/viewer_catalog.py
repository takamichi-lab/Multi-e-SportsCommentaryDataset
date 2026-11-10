"""Discover the maintained Score datasets and matching original videos."""

import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = {
    "Apex": "Apex_gemma4_squads_csv/*.csv",
    "Baseball": "Baseball_gemma4_csv_1003/*.csv",
    "League of Legends": "League of Legends_gemma4_csv/*.csv",
    "Legends of Runeterra": "Legends of Runeterra_csv/*.csv",
    "Poker": "Poker_hand_analysis_v2/*/poker_cleaned_filtered.csv",
    "Street_Fighter": "Street_Fighter_arrign_csv/*.csv",
    "basketball": "basketball_gemma4_0724_cut_csv_time_fixed4/*.csv",
    "dota2": "dota2_score_ocr_csv/*.csv",
    "hearthstone": "hearthstone_csv/*.csv",
    "judo": "judo_score_csv/*.csv",
    "keiba": "*.csv",
    "mahjang": "mahjang_gemma4_ranking_events/*.mp4/events.csv",
    "shadowverse": "shadowverse_gemma4_score_cleaned_csv/*.csv",
    "tekken": "tekken_gemma4_score_cleaned_csv/*.csv",
    "valorant": "valorant_gemma4_score_cleaned_csv/*.csv",
}


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        rows, warnings = [], []
        columns = reader.fieldnames or []
        for index, row in enumerate(reader, 2):
            if None in row.values():
                warnings.append(f"CSV {index}行目の不足列を空欄として表示します。")
            extra = row.pop(None, None)
            clean = {key: value or "" for key, value in row.items()}
            if extra:
                if "__extra_columns" not in columns:
                    columns = [*columns, "__extra_columns"]
                clean["__extra_columns"] = ",".join(extra)
                warnings.append(f"CSV {index}行目の余分な値を__extra_columnsに表示します。")
            rows.append(clean)
        return {"columns": columns, "rows": rows, "warnings": warnings}


def base_name(path, sport):
    if sport == "mahjang":
        return path.parent.stem
    if sport == "Poker":
        return path.parent.name
    if sport == "basketball":
        return path.stem.removesuffix("_1")
    if sport == "Apex":
        return path.name.removesuffix(".mp4_match_squads.csv")
    name = path.stem
    for suffix in ("_gemma4_score_rate_cleaned", "_gemma4_score_cleaned", "_score"):
        if name.endswith(suffix):
            return name.removesuffix(suffix)
    return name


def catalog():
    entries = []
    for sport, pattern in SOURCES.items():
        videos = {
            p.stem: p for p in (ROOT / sport / f"{sport}_mp4").glob("*.mp4")
            if p.is_file()
        }
        used = set()
        for path in sorted((ROOT / "Score" / sport).glob(pattern)):
            name = base_name(path, sport)
            video = videos.get(name)
            used.add(name)
            entries.append({
                "id": path.relative_to(ROOT).as_posix(), "sport": sport,
                "name": name, "csv": path.relative_to(ROOT).as_posix(),
                "video": video.relative_to(ROOT).as_posix() if video else None,
            })
        for name in sorted(videos.keys() - used):
            video = videos[name].relative_to(ROOT).as_posix()
            entries.append({"id": video, "sport": sport, "name": name,
                            "csv": None, "video": video})
    return entries


def dataset(entry):
    data = read_csv(ROOT / entry["csv"]) if entry["csv"] else {"columns": [], "rows": []}
    bounds_path = ROOT / entry["sport"] / f'{entry["sport"]}_csv' / f'{entry["name"]}.csv'
    bounds = []
    # VALORANT's legacy ID identifies a round, while Score.game_id identifies
    # a whole map. Joining these identifiers truncates maps to single rounds.
    # Use each map's score observation span instead.
    # Shadowverse likewise uses the first/last Score observation per game_id.
    if entry["sport"] not in {"valorant", "shadowverse"} and bounds_path.is_file():
        raw = read_csv(bounds_path)
        if {"start", "end", "ID"} <= set(raw["columns"]):
            bounds = [{"start": row["start"], "end": row["end"], "id": row["ID"]}
                      for row in raw["rows"]]
    return {**entry, **data, "bounds": bounds,
            "bounds_source": bounds_path.relative_to(ROOT).as_posix() if bounds else None}
