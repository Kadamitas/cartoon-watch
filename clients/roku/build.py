import argparse
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def package(output):
    source = Path(__file__).resolve().parent
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    files = [source / "manifest"]
    for folder in ("source", "components", "images"):
        files.extend(sorted(path for path in (source / folder).rglob("*") if path.is_file()))
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.relative_to(source).as_posix())
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Package the Cartoon Watch Roku developer channel.")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[2] / "outputs" / "Cartoon-Watch-Roku.zip")
    args = parser.parse_args()
    print(package(args.output))
