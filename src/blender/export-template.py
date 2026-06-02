import argparse
import json
import os
from pathlib import Path

import bpy


def parse_args():
    argv = []
    if "--" in os.sys.argv:
        argv = os.sys.argv[os.sys.argv.index("--") + 1 :]

    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["inspect", "export"], required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--texture-size", type=int, default=2048)
    parser.add_argument("--includes-animation", default="false")
    return parser.parse_args(argv)


def ensure_dir(path_str):
    path = Path(path_str)
    path.mkdir(parents=True, exist_ok=True)
    return path


def list_editor_meshes():
    meshes = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        name = obj.name or ""
        lower = name.lower()
        if "drawable" not in lower and "editable" not in lower:
            continue
        meshes.append(
            {
                "meshKey": name,
                "displayLabel": name,
            }
        )
    return meshes


def resolve_image_path(image):
    try:
        raw_path = image.filepath_from_user()
    except Exception:
        raw_path = image.filepath or image.filepath_raw or ""

    if not raw_path:
        return None

    try:
        absolute = bpy.path.abspath(raw_path)
    except Exception:
        absolute = raw_path

    return str(Path(absolute))


def collect_image_diagnostics():
    diagnostics = []

    for image in bpy.data.images:
        packed = bool(getattr(image, "packed_file", None))
        source = getattr(image, "source", "UNKNOWN")
        resolved_path = resolve_image_path(image)
        exists = packed or (bool(resolved_path) and Path(resolved_path).exists())
        diagnostics.append(
            {
                "name": image.name,
                "source": source,
                "packed": packed,
                "path": resolved_path,
                "exists": bool(exists),
                "width": int(image.size[0]) if image.size else 0,
                "height": int(image.size[1]) if image.size else 0,
            }
        )

    return diagnostics


def validate_images_for_export():
    diagnostics = collect_image_diagnostics()
    missing = [
        item
        for item in diagnostics
        if item["source"] == "FILE" and not item["packed"] and not item["exists"]
    ]

    if missing:
        preview = "\n".join(
            f'- {item["name"]}: {item["path"] or "(경로 없음)"}'
            for item in missing[:10]
        )
        raise RuntimeError(
            "Blend file references external texture files that are not included in the upload.\n"
            "현재 업로드 방식은 .blend 단일 파일만 전송하므로, 텍스처는 Blender에서 Pack Resources 한 뒤 업로드해야 합니다.\n"
            f"Missing textures ({len(missing)}):\n{preview}"
        )

    return diagnostics


def max_texture_size():
    size = 0
    for image in bpy.data.images:
        if not image.size:
            continue
        size = max(size, image.size[0], image.size[1])
    return size or 2048


def resize_images(target_size):
    for image in bpy.data.images:
        if not image.size or image.source != "FILE":
            continue
        width, height = image.size[0], image.size[1]
        if width <= target_size and height <= target_size:
            continue
        scale = min(target_size / width, target_size / height)
        next_width = max(1, int(width * scale))
        next_height = max(1, int(height * scale))
        image.scale(next_width, next_height)


def export_gltf(output_dir, includes_animation):
    filepath = str(Path(output_dir) / "model.gltf")
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format="GLTF_SEPARATE",
        export_draco_mesh_compression_enable=False,
        export_animations=includes_animation,
        export_optimize_animation_size=False,
        export_keep_originals=True,
        export_yup=True,
        export_image_format="AUTO",
    )


def write_manifest(output_dir):
    image_diagnostics = collect_image_diagnostics()
    manifest_path = Path(output_dir) / "mesh-manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "maxTextureSize": max_texture_size(),
                "meshes": list_editor_meshes(),
                "images": image_diagnostics,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def main():
    args = parse_args()
    output_dir = ensure_dir(args.output_dir)

    if args.mode == "inspect":
        write_manifest(output_dir)
        return

    validate_images_for_export()
    resize_images(args.texture_size)
    export_gltf(output_dir, args.includes_animation.lower() == "true")
    write_manifest(output_dir)


if __name__ == "__main__":
    main()
