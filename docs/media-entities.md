# Media entities: a picture served by the DPC

An OData v2 entity whose content is a stream. The model marks the type
(`set_is_media` in the MPC, `m:HasStream="true"` in `$metadata`), the
client reads and writes the bytes at `<entity>/$value`, and the DPC is the
one holding them (`GET_STREAM`, `UPDATE_STREAM`, `CREATE_STREAM`). The
demo has one: `PhotoSet`, the picture of a travel.

```
GET  /sap/opu/odata/sap/ZSTG_DEMO_SRV/PhotoSet('T0001')/$value   -> image/png, 930 bytes
PUT  /sap/opu/odata/sap/ZSTG_DEMO_SRV/PhotoSet('T0001')/$value   -> 204, the new picture
GET  /sap/opu/odata/sap/ZSTG_DEMO_SRV/PhotoSet('T0001')?$format=json
     -> __metadata.media_src / edit_media point at that URL
```

## What carries it

- **The table** `ZSTG_PHOTO` (`src/ddic/zstg_photo.tabl.xml`): travel id,
  MIME type, file name and `CONTENT` as `RSTR` (the transpiler stores an
  `xstring` as hex text in SQLite, so `data/zstg_photo.tabu.json` seeds the
  pictures as hex; they are generated PNGs, one per travel).
- **The model** (`src/demo/zcl_zstg_demo_mpc.clas.abap`, or `media: true`
  in `zstg_demo.stg.yaml`): entity type `Photo` with `set_is_media( 'X' )`,
  its properties are what is known *about* the picture, never the bytes.
- **The DPC** (`src/demo/zcl_zstg_demo_dpc_ext.clas.abap`):
  `GET_STREAM` selects the row and hands back the media resource the
  interface declares (`mime_type` + `value`) through `copy_data_to_ref`;
  `UPDATE_STREAM` writes the new bytes. Both check the entity set name and
  call `super->` otherwise, the way a DPC with several media entities does.
- **The gateway**: `zcl_stg_url` parses the `/$value` tail,
  `zcl_stg_dispatcher=>media` calls the DPC and answers with
  `ty_response-body_x` (bytes, not text) and the resource's MIME type,
  `zcl_stg_json` adds `media_src` / `edit_media` to `__metadata` of a media
  entity, and `zcl_stg_http_handler` sends `body_x` with `set_data` instead
  of `set_cdata` (the express shim writes the buffer, the service worker
  the same).
- **The library**: `set_is_media` was a stub; open-abap-odata #63 keeps the
  flag and renders `m:HasStream="true"`.

## How Fiori Elements shows it

A V2 app does not follow `media_src` by itself. What it follows is a
property whose value is a URL, annotated `UI.IsImageURL`:

```yaml
entities:
  Travel:
    properties:
      PhotoUrl: {type: String(120), field: PHOTO_URL, readonly: true, label: Photo}
annotations:
  Travel:
    header: {typeName: Travel, title: Description, imageUrl: PhotoUrl}
    lineItem:
      - {value: PhotoUrl, label: Photo}
  Travel/PhotoUrl: {label: Photo, isImageUrl: true}
```

The DPC fills `PhotoUrl` with the media resource's URL
(`fill_photo_url`), the list report renders the column as pictures and the
object page header shows the same image. The URL is relative to the page
the app is served from (`../sap/opu/odata/sap/…`, `gc_media_base` in the
DPC), which is what works both locally and in the browser preview; on a
system it is the absolute `/sap/opu/odata/sap/…`, the same one-line change
as the manifest's `dataSources` (AGENDA, "The Fiori apps").

## Tested

- `ltcl_media` in `test/unit/zcl_stg_gateway_test`: `m:HasStream` in
  `$metadata` and only on the media type, `media_src` / `edit_media` in the
  JSON, the PNG bytes and their length over the dispatcher, a PUT that
  replaces them and is read back, a 400 for `$value` on an ordinary entity
  set and for a picture that is not there.
- `test/mocha.mjs`: the same over HTTP, content type included.
- `test/e2e/listreport.spec.mjs`: the column of pictures in the list report
  and the picture in the object page header, both with the `$value` URL.

## Not yet

`CREATE_STREAM` (POST with a slug, which creates the entity and its
content in one go), `DELETE` of a media resource, streaming answers (the
whole picture is one `xstring` in memory), ETags on a media resource, and a
content-type property marked with `set_as_content_type` (no corpus project
has one, so there is nothing to copy).
