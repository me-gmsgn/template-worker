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
    manifest_path = Path(output_dir) / "mesh-manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "maxTextureSize": max_texture_size(),
                "meshes": list_editor_meshes(),
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

    resize_images(args.texture_size)
    export_gltf(output_dir, args.includes_animation.lower() == "true")
    write_manifest(output_dir)


if __name__ == "__main__":
    main()
