# Template Worker

`@mws/template-worker`는 OS에서 업로드된 `.blend` 원본을 받아 템플릿 에셋 세트로 변환하는 전용 워커입니다.

## 입력

`POST /process-template-upload`

```json
{
  "templateId": "template_123",
  "sourceBlendStorageKey": "templates/template_123/source/example.blend"
}
```

## 출력 계약

- 숫자 prefix가 붙은 메시 이름을 정렬 순서로 사용합니다.
- `{color...}` 토큰은 tint binding으로 해석합니다.
- `drawable` 또는 `editable`가 포함된 메시만 editor mesh로 반환합니다.
- export 프로필은 다음 조합을 기본으로 사용합니다.
  - `light` / `medium` / `heavy`
  - `light-animated` / `medium-animated` / `heavy-animated`
- `4096` 원본 텍스처가 없으면 `heavy` 계열은 생략합니다.

## 로컬 실행

```bash
pnpm --filter @mws/template-worker start
```

## Docker 실행

1. `.env.example`를 `.env`로 복사합니다.
2. `S3_STORAGE_ENDPOINT`는 public `s3.veer.kr`가 아니라 내부 MinIO origin(`http://minio:9000`)을 사용합니다.
3. `STORAGE_NETWORK_NAME`에는 MinIO가 붙어 있는 Docker external network 이름을 넣습니다.
4. `CF_TUNNEL_TOKEN`을 넣고 Cloudflare tunnel 라우팅을 `template-worker`로 연결합니다.
5. 아래처럼 실행합니다.

```bash
docker compose -f docker-compose.example.yml up -d
```

## 현재 가정

- 모든 derived asset은 `S3_PUBLIC_ENDPOINT` 기준 public URL로 다시 저장됩니다.
- glTF geometry에는 Draco/Meshopt를 적용하지 않습니다.
- 텍스처는 `gltf-transform resize` + `gltf-transform uastc` 체인으로 KTX2 변환을 시도합니다.
- 실제 Blender scene 규칙은 `src/blender/export-template.py` 기준으로 맞춥니다.
