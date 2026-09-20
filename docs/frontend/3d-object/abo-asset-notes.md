# Amazon Berkeley Objects (ABO) assets

2026-09-20 · Saketh's asset lane · First item landed as a spike: `abo-B072M1WJ8S`, Rivet Emerly sofa.

## What ABO is, and why it is different

[Amazon Berkeley Objects](https://amazon-berkeley-objects.s3.amazonaws.com/index.html): 147,702 Amazon product listings, 7,953 of them with an artist-made glTF model. It is the first source here where **the model and the measurements come from the same record**. Every other asset has been a dimension-provenance problem: a generated mesh fitted to numbers read off a product page.

Conventions match ours without conversion: metres, +Y up, +Z front, floor-standing products centred on the origin and standing on Y = 0.

## Licence: CC BY 4.0, verified 2026-09-20

We expected CC BY-NC. The dataset's own `README.md`, `LICENSE-CC-BY-4.0.txt` and website, all read from the bucket on 2026-09-20, say **Creative Commons Attribution 4.0 International**, which is less restrictive. Every ABO asset's `metadata.json` carries the licence, the attribution and what we changed, and `backend/api/test_furniture_assets.py` asserts they are there.

**Attribution for the Devpost and anywhere the models are shown:**

> 3D models and product data from Amazon Berkeley Objects © Amazon.com, licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Dataset built by Matthieu Guillaumin, Thomas Dideriksen, Kenan Deng, Himanshu Arora (Amazon.com), Jasmine Collins and Jitendra Malik (UC Berkeley). Models were modified: textures resized, meshes simplified.

## Importing one product

```bash
mkdir -p .scratch/abo/meta && cd .scratch/abo/meta     # once: 87 MB of metadata, about five seconds
curl -sSO https://amazon-berkeley-objects.s3.amazonaws.com/3dmodels/metadata/3dmodels.csv.gz
for i in 0 1 2 3 4 5 6 7 8 9 a b c d e f; do curl -sSO "https://amazon-berkeley-objects.s3.amazonaws.com/listings/metadata/listings_${i}.json.gz"; done

cd backend
uv run python ../scripts/abo_import.py B072M1WJ8S --category sofa --price-cents 0 --price-provenance placeholder
```

It downloads the GLB (tens of MB, 4096 px textures), strips cameras, lights, animations and skins, runs `gltf-transform optimize --compress false --texture-compress auto --texture-size 1024 --simplify`, stands the model on the floor at its listed height, checks it by the asset test's own rules, then writes `shared/models/furniture/abo-<ASIN>/` and appends the listing. Exit 1 with a printed reason means the product was refused; nothing is written. Afterwards: run the suite, merge, then re-ingest from `main` and run `python -m catalogue.index_check`.

The sofa: 51.9 MB became 2.72 MB and 13,822 triangles; measured 212.19 × 88.94 × 86.40 cm against 2121 × 889 × 864 mm.

## Traps, each with a check behind it

- **The unit is usually inches.** Of the dimension fields on products with a model, 20,502 are inches, 2,699 centimetres, 174 millimetres and 1 metres. `to_mm` parses the unit, refuses an unknown one, and refuses a record whose `value` and `normalized_value` disagree. The test replays the old 2.6× chair: the sofa's 83.5 in read as 83.5 cm fails two assertions.
- **"width" and "length" do not mean left-to-right and front-to-back.** The sofa's record says width 35 in, length 83.5 in: its "width" is its depth. The model decides (X is width, Z is depth), and must then agree with the record inside the asset tolerance.
- **ABO scaled its models to `item_dimensions`**, so a wrong record gives a wrongly sized model that agrees with itself. One real case: a nightstand titled `21.7"W` whose record, and model, are 170 cm wide. A size stated in the title must agree with the record or the product is refused. Where the title states no size, look at the numbers before importing.
- **Half the models disagree with their record** (4,004 of 7,960 listings) once the axes are matched, usually because the record describes the box it ships in. Those are refused. 3,297 products pass, among them 527 rugs, 428 chairs, 292 tables, 204 sofas, 87 lamps, 48 shelves and 21 vases.
- **ABO has no price.** The field does not exist. `price_cents` is required by the listing contract and the results card prints it, so an ABO listing's price is a placeholder, recorded as `priceProvenance: "placeholder"` in the asset's `metadata.json`.
- **Colours come from the 30-colour seed palette**, the nearest to ABO's `color_code`, because `backend/catalogue/test_scale.py` requires the hero colours to equal that palette.
- **`matchType` is `verified`** for every ABO binding: the model is the product. If that cannot be shown for an item, the item is not taken.
