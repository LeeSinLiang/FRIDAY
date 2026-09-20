# Amazon Berkeley Objects (ABO) assets

2026-09-20 · Saketh's asset lane · Started as a one-item spike (`abo-B072M1WJ8S`, Rivet Emerly sofa), then a batch for the living-room demo. The imported products are listed at the end.

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
uv run --with pillow python ../scripts/abo_import.py B072M1WJ8S --category sofa --price-cents 0 --price-provenance placeholder
```

It downloads the GLB (tens of MB, 4096 px textures), strips cameras, lights, animations and skins, runs `gltf-transform optimize --compress false --texture-compress auto --texture-size 512 --simplify`, stands the model on the floor at its listed height, checks it by the asset test's own rules, then writes `shared/models/furniture/abo-<ASIN>/` and appends the listing. Exit 1 with a printed reason means the product was refused; nothing is written. `--with pillow` is only needed for products without a `color_code` (every lamp and vase), whose colour is read from the model's own texture; Pillow is not a project dependency. Afterwards: run the suite, merge, then re-ingest from `main` and run `python -m catalogue.index_check`.

The sofa: 51.9 MB became 0.98 MB and 13,822 triangles; measured 212.19 × 88.94 × 86.40 cm against 2121 × 889 × 864 mm.

**512 px textures, measured on three products:** sofa 2.72 → 0.98 MB, armchair 2.27 → 0.83 MB, side table 1.96 → 0.69 MB, about 36% of the 1024 px file. The base-colour atlas is fabric or wood grain; at room distance the difference is not visible.

## Importing a batch

```bash
cd backend
uv run python ../scripts/abo_select.py --out ../.scratch/abo/plan.json          # about a second; prints the plan to read
uv run python ../scripts/abo_select.py --profile office --out ../.scratch/abo/plan-office.json
uv run --with pillow python ../scripts/abo_batch.py ../.scratch/abo/plan.json   # about 7 s a product, mostly download
```

`abo_select.py` keeps a product only if its dimensions parse with their unit, its model agrees with them, **its title states a size that agrees with the record**, and its title says plainly what it is. It takes one product per distinct size, because five colours of one chair is padding, and lists spares after each quota. `abo_batch.py` walks the plan until each quota is met; a product the importer refuses once it has the real file is replaced by the next spare. Being picky is free: of about 8,000 modelled products, 117 sofas, 100 tables, 92 armchairs, 62 lamps, 25 dining chairs, 14 vases and 6 bookcases pass every gate.

## Office furniture, and why office chairs are scarce

`--profile office` selects desks, file cabinets, sideboards, desk lamps, a bookcase and dining tables. ABO has no table titled conference, meeting or boardroom. A 1.8 m rectangular table in a meeting room IS a meeting table, so dining tables are used there **and keep their label**: relabelling them would be the dishonest move, not using them.

**Office chairs are scarce for a real reason, not a bug. Do not "fix" it.** Of 75 products titled office, desk or task chair, 48 fail the model-against-record check outright and only three pass every gate. An adjustable chair is modelled at one height while its record states another (often the top of the range, or the box), so model and record disagree by more than the tolerance; that disagreement is EXPECTED for this category and says nothing about the importer. Most of the rest have titles that state no size (the AmazonBasics chairs never do), so nothing independent confirms the record. One, the Rivet Swope, is refused correctly on its own words: the title says 26"W and the record 630 mm, 4.8% apart. Loosening either gate for this category would import chairs whose size nobody can vouch for. If more desk seating is needed, use dining or accent chairs, labelled as what they are.

## The triangle budget and the simplify ladder

`gltf-transform --simplify` stops at an error tolerance, not a ratio (`--simplify-ratio` defaults to 0, "as far as possible", so adding a ratio never simplifies more). A model that is over 30,000 triangles at the default tolerance of 0.0001 of its extent is tried again at 0.0003, 0.001, 0.003 and 0.01, and the first result inside the budget is kept; 0.01 is 1 cm on a 1 m chair, and the ladder stops there. The tolerance that was needed is recorded as `source.simplifyError`. The Rivet Celine task chair went from 48,085 triangles at the default to inside the budget one step up. A model over the byte budget is refused, not retried.

## Traps, each with a check behind it

- **The unit is usually inches.** Of the dimension fields on products with a model, 20,502 are inches, 2,699 centimetres, 174 millimetres and 1 metres. `to_mm` parses the unit, refuses an unknown one, and refuses a record whose `value` and `normalized_value` disagree. The test replays the old 2.6× chair: the sofa's 83.5 in read as 83.5 cm fails two assertions.
- **"width" and "length" do not mean left-to-right and front-to-back.** The sofa's record says width 35 in, length 83.5 in: its "width" is its depth. The model decides (X is width, Z is depth), and must then agree with the record inside the asset tolerance.
- **ABO scaled its models to `item_dimensions`**, so a wrong record gives a wrongly sized model that agrees with itself, and the bounding-box assertion cannot catch it. One real case: a nightstand titled `21.7"W` whose record, and model, are 170 cm wide. **The title is the only independent witness, so it is a gate:** a product is imported only if its title states a size, with a unit, that agrees with the record within 3%, and every size the title states must agree. A title with no size is skipped, never eyeballed. `9W`, `5-Tier` and `2-Pack` are not sizes. What the title confirmed is recorded as `source.titleConfirms` and asserted.
- **The index file is not the model.** Two armchairs whose `3dmodels.csv.gz` extents matched their record measured 23 mm and 34 mm off once the real file was processed. The importer re-measures the finished GLB and refused both.
- **ABO's product types are coarse.** `CHAIR` holds armchairs, dining chairs and ottomans. Categories come from title keywords (`accent chair`, `dining chair`, `coffee table`, …) with exclusions (`ottoman`, `stool`, `outdoor`, …); a product whose title does not say plainly what it is, is skipped.
- **Half the models disagree with their record** (4,004 of 7,960 listings) once the axes are matched, usually because the record describes the box it ships in. Those are refused. 3,297 products pass, among them 527 rugs, 428 chairs, 292 tables, 204 sofas, 87 lamps, 48 shelves and 21 vases.
- **ABO has no price, and 0 means unknown.** The field does not exist in the dataset. `price_cents` is required by the listing contract, so every ABO listing carries `0`, the asset's `metadata.json` says `priceProvenance: "placeholder"`, and the asset test refuses any other number beside that provenance: an invented price on a real, named product is a claim about a real thing. See "Unknown price" below for what search and the card must do with it.
- **Colours come from the 30-colour seed palette**, because `backend/catalogue/test_scale.py` requires the hero colours to equal that palette: the nearest palette colour to ABO's `color_code`, or, where the record has none, to the median of the model's base-colour texture (the median ignores the small islands of legs and hardware in the atlas). `source.colour` and `source.colourSource` record which.
- **`matchType` is `verified`** for every ABO binding: the model is the product. If that cannot be shown for an item, the item is not taken.

## Unknown price: what search and the card must do (decided by Saketh, 2026-09-20)

An unknown price cannot satisfy a price constraint. "Under $400" that includes every product whose price we do not know makes the filter a lie, and with results limited to model-backed listings most of what a shopper sees would be ABO.

- `price_max` and `price_min` must match only listings with `price_cents > 0`, in both backends (`backend/catalogue/memory.py`, `backend/catalogue/to_es_query.py`).
- The price-band facet must not count them: today a 0 lands in `0-10000`, the same lie in another place (`backend/catalogue/facets.py`, both the memory counter and the Elasticsearch `range` aggregation).
- The results card shows **"price unavailable"**, not `$0` and not nothing (`frontend/src/catalogue/CatalogueShelf.tsx`; the dev search page prints the price too).

Those files are the catalogue lane's. Probe against today's code, nothing written: one extra sofa at `price_cents` 0 is returned by `price_max=40000`, and moves the sofa price bands from `0-10000: 0` to `0-10000: 1`. **Consequence for the demo:** the hero sentence says "under $400", so it returns only priced listings, the IKEA ones. The ABO breadth shows on every other query.

The catalogue's prices do not reach the Visa checkout today, which accepts only its own fixture products. If that changes, a room furnished from ABO would bill $0 for those items, so a total must say what it could price and what it could not ("142 items placed · 96 priced · $48,210"), never fill the gap with a number. `priceProvenance` is the field to read.

## The results list does not fetch models

Checked in the code on 2026-09-20: a results card renders `thumb_url` (a generated SVG data URI, no request), the title, price and size. Hovering a card runs the region solver and lights the floor; the pending ghost is a box. A GLB is requested only when an item is in the scene (`createFurnitureVisual` in `frontend/src/scene/playcanvas/furniture.ts`, `FurnitureModel.tsx` in the legacy editor). Fifty cards fetch no models.

## What is in the catalogue (2026-09-20)

51 products, 36.4 MB of GLBs in all (largest 1.57 MB): 11 armchair, 4 chair, 4 decor, 8 lamp, 5 shelf, 9 sofa, 10 table. No rugs: a rug's footprint would block the floor under it until the solver lets items a few centimetres tall be stood on. No product is a multi-pack: one model is one object.

The batch took about four minutes for fifty products. Eight were refused and replaced by spares: six whose finished model missed the record by 23 to 34 mm on one axis (a model 3% off in height, scaled uniformly to its listed height, carries that 3% into its width), one over the triangle budget (30,581), and the spike sofa, already listed. Two more were taken out by hand afterwards: a "Pack of 2" dining chair, which the selector now excludes, and a vase whose title contains the word "green", because `catalogue.test_compile.CompileEndpointTests.test_model_failure_is_a_200_with_a_text_search` assumes no listing matches that word. That test belongs to the catalogue lane and will trip on the first green product anyone adds.

**Tabletop objects**, which the solver's stacking rule needs and the catalogue had none of: the four vases and the six table or desk lamps (every lamp under 70 cm).

| Category | Listing | Title | w × d × h, mm | Title confirms | MB |
| --- | --- | --- | --- | --- | --- |
| armchair | `abo-B07DBDZ3WW` | Ravenna Home Contemporary Faux Leather Nailhead Wingback Accent Chair, 28.5"W, Black | 724 × 813 × 1148 | 724 mm W | 0.78 |
| armchair | `abo-B071W5VJFK` | Rivet Cove Modern Tufted Accent Chair with Tapered Legs, Mid-Century, 32.7"W, Light Grey | 831 × 861 × 899 | 831 mm W | 0.75 |
| armchair | `abo-B07P5LN39V` | Rivet Emerly Modern Living Room Chair, 41"W, Steel Grey | 1041 × 889 × 864 | 1041 mm W | 0.99 |
| armchair | `abo-B082QCY5SV` | Rivet New Luna Upholstered Crescent Mid-Century Accent Chair with Tapered Legs, 31.5"W, Teal | 800 × 890 × 930 | 800 mm W | 1.09 |
| armchair | `abo-B07BWKFNF6` | Rivet Revolve Modern Upholstered Armchair with Tapered Legs, 33"W, Linen | 831 × 879 × 899 | 838 mm W | 0.90 |
| armchair | `abo-B082QCVWWF` | Rivet Spear Mid-Century Modern Channel Tufted Leather Accent Chair with Wood Arms, 29.1"W, Grey | 739 × 800 × 831 | 739 mm W | 0.85 |
| armchair | `abo-B07QFP4WFR` | Rivet Stacey Mid-Century Modern Round-Backed, Armless Living Room Chair, 27"W, Sangria | 700 × 660 × 760 | 686 mm W | 1.14 |
| armchair | `abo-B082QCB52Z` | Rivet Theresa Modern Upholstered Accent Chair, 30"W, Slate | 762 × 787 × 838 | 762 mm W | 1.57 |
| armchair | `abo-B075X4YDN6` | Rivet Zane Mid-Century Modern Swivel Top-Grain Leather Accent Chair, 28.75" W, Saddle | 730 × 870 × 864 | 730 mm W | 0.68 |
| armchair | `abo-B07P5LP5MC` | Stone & Beam Lauren Down-Filled Oversized Leather Living Room Accent Armchair with Hardwood Frame, 46"W, Dark Brown | 1170 × 1140 × 950 | 1168 mm W | 1.27 |
| armchair | `abo-B075X342T5` | Stone & Beam Westport Modern Nailhead Upholstered Accent Arm Chair, 36"W, Stone Brown | 914 × 959 × 838 | 914 mm W | 1.19 |
| chair | `abo-B07HSBJ5D6` | Rivet Dunford Modern Kitchen Dining Chair, 33 Inch Height, Ivory | 610 × 610 × 838 | 838 mm | 0.84 |
| chair | `abo-B085554J7Q` | Rivet Henrik Modern Open-Back Plastic Dining Chair, 18.5"W, Mild Gray | 470 × 556 × 790 | 470 mm W | 0.51 |
| chair | `abo-B08569F1GX` | Rivet Vern Contemporary Round Back Swivel Dining Chair with Arms, 23"W, Spearmint | 590 × 610 × 810 | 584 mm W | 0.69 |
| chair | `abo-B07QJ1X2QB` | Stone & Beam Mid-Century Wishbone Dining Chair, 22.4"W, Black / Natural | 569 × 579 × 730 | 569 mm W | 1.04 |
| decor | `abo-B07JM6GHC8` | Stone & Beam Emerick Rustic Tall Stoneware Decor Vase with Geometric Pattern - 15 Inch, Brown and White | 185 × 185 × 380 | 381 mm | 0.40 |
| decor | `abo-B07B8PXTSY` | Stone & Beam Modern Ombre Stoneware Home Decor Flower Vase - 10 Inch, Dark Brown Red White | 105 × 105 × 260 | 254 mm | 0.25 |
| decor | `abo-B07B8NVHX1` | Stone & Beam Modern Ombre Stoneware Home Decor Flower Vase - 8 Inch, Dark Brown Red White | 108 × 108 × 203 | 203 mm | 0.18 |
| decor | `abo-B0842L2D5N` | Stone & Beam Shibori Inspired Stoneware Vase, 11.6"H, Blue and White | 160 × 160 × 295 | 295 mm H | 0.26 |
| lamp | `abo-B0824FBQF3` | Ravenna Home Traditional Chinoiserie Ceramic Table Lamp, LED Bulb Included, 15"H, Blue Circle | 216 × 216 × 381 | 381 mm H | 0.56 |
| lamp | `abo-B082XLB716` | Rivet Globe Stick Floor Lamp, 69"H, White Marble | 229 × 229 × 1753 | 1753 mm H | 0.27 |
| lamp | `abo-B0825DHHVM` | Rivet Scandinavian Real Blond Wood Table Lamp, LED Bulb Included, 17"H, Beige | 229 × 229 × 432 | 432 mm H | 0.55 |
| lamp | `abo-B0825D873D` | Rivet Scandinavian Striped Floor Lamp, LED Bulb Included, 58.25"H, Black and Blond Wood | 381 × 381 × 1480 | 1480 mm H | 0.48 |
| lamp | `abo-B0825DNRXL` | Rivet Scandinavian Striped Table Lamp, LED Bulb Included, 25.25"H, Black and Blond Wood | 305 × 305 × 641 | 641 mm H | 0.50 |
| lamp | `abo-B073755HVV` | Stone & Beam Industrial Round Concrete Table Desk Lamp with Light Bulb and Beige Shade, 16"H, Brushed Nickel | 254 × 254 × 406 | 406 mm H | 0.85 |
| lamp | `abo-B073772TP9` | Stone & Beam Modern Slate Rock Table Desk Lamp with Light Bulb And Linen Shade,16"H, Polished Nickel | 292 × 178 × 406 | 406 mm H | 0.96 |
| lamp | `abo-B0825D147R` | Stone & Beam Traditional Rectangular Chinoiserie Ceramic Table Lamp, LED Bulb Included, 24"H, Blue Circle | 330 × 330 × 610 | 610 mm H | 0.82 |
| shelf | `abo-B082JGV1YM` | Stone & Beam 5-Shelf Bookcase, 75"H, Weathered Oak Finish | 805 × 335 × 1905 | 1905 mm H | 0.73 |
| shelf | `abo-B075ZF4S39` | Stone & Beam Barrett Reclaimed Wood 4-Shelf Bookcase, 40"W, White and Sandstone Pine | 1016 × 381 × 1880 | 1016 mm W | 0.31 |
| shelf | `abo-B075ZBW22K` | Stone & Beam Bryson Tall Narrow 3-Drawer Bookcase, 19.7"W, Wood | 500 × 419 × 1900 | 500 mm W | 0.58 |
| shelf | `abo-B075Z6YS1Z` | Stone & Beam Larson Industrial Wood and Metal 4-Shelf Bookcase, 73"H, Walnut | 864 × 356 × 1861 | 1854 mm H | 0.42 |
| shelf | `abo-B07B7DL32H` | Stone & Beam Rustic Casual Wood Bookcase with Doors, 36"W, Grey | 914 × 356 × 1880 | 914 mm W | 1.25 |
| sofa | `abo-B07DBDRN8S` | Ravenna Home Rai Tufted Arched Armless Loveseat Bench Settee, 52"W, Light Grey | 1321 × 813 × 1156 | 1321 mm W | 0.68 |
| sofa | `abo-B082QDKRC5` | Rivet Bayard Contemporary Leather Couch with Curved Back and Armrests, 76"W, Cognac | 1930 × 870 × 830 | 1930 mm W | 1.01 |
| sofa | `abo-B072M1WJ8S` | Rivet Emerly Mid-Century Modern Velvet Metal Leg Sofa Couch, 83.5"W, Pewter | 2121 × 889 × 864 | 2121 mm W | 0.98 |
| sofa | `abo-B07P5LM5CQ` | Rivet Emerly Modern Sofa Chaise, 96"W, Steel Grey | 2438 × 1626 × 864 | 2438 mm W | 0.95 |
| sofa | `abo-B07P5LMFPN` | Rivet Revolve Modern Leather Loveseat Sofa, 56"W, Black | 1430 × 879 × 899 | 1422 mm W | 0.91 |
| sofa | `abo-B07P7NVGFL` | Rivet Sloane Mid-Century Modern Sofa with Tufted Back, 79.9"W, Storm | 2029 × 909 × 841 | 2029 mm W | 1.15 |
| sofa | `abo-B075X2X4GY` | Rivet Uptown Mid-Century Velvet Tufted Customizable Daybed Sofa, 78"W, Dove Grey & Brass | 1981 × 686 × 635 | 1981 mm W | 0.81 |
| sofa | `abo-B07B4M38B4` | Stone & Beam Andover Modern Loveseat Sofa, 67"W, Cream | 1702 × 965 × 889 | 1702 mm W | 0.90 |
| sofa | `abo-B07B4M4HDS` | Stone & Beam Andover Modern Sofa Couch, 78"W, Sand | 1981 × 965 × 889 | 1981 mm W | 0.99 |
| table | `abo-B07DBDZ2TG` | Ravenna Home Flush Mount Wood Cross Side Table, 23.6"W, Dark Brown Walnut | 600 × 560 × 560 | 599 mm W | 0.12 |
| table | `abo-B07DBDMN5F` | Ravenna Home Parker Coffee Table, 47.2"W, Glass & Gold | 1199 × 599 × 399 | 1199 mm W | 0.29 |
| table | `abo-B07QGFZ2B4` | Rivet Industrial Mango-Topped Side Table, 19.61"W | 498 × 498 × 550 | 498 mm W | 0.35 |
| table | `abo-B07QC876Z6` | Rivet Modern Coffee Table, 39.37"W, Pine Veneer and Natural Wood | 1000 × 550 × 420 | 1000 mm W | 0.51 |
| table | `abo-B07QFB1TH8` | Rivet Modern Sliding-Top Coffee Table, 47"W | 1194 × 610 × 330 | 1194 mm W | 0.68 |
| table | `abo-B075Z876TX` | Stone & Beam Coastal Breeze Rustic Farmhouse Console Table, 55.1"W, Natural and White | 1400 × 450 × 932 | 1400 mm W | 0.30 |
| table | `abo-B075Z85K2F` | Stone & Beam Culver Reclaimed Industrial Wood Coffee Table, 55.1"W, Natural and Steel | 1400 × 800 × 439 | 1400 mm W | 0.42 |
| table | `abo-B075Z6S9CY` | Stone & Beam Roland X-Frame Side End Table, 24"W, Pine | 610 × 610 × 508 | 610 mm W | 0.29 |
| table | `abo-B07QFB1TLZ` | Stone & Beam Ryder Industrial Round Coffee Table, 43.3" Diameter, Brushed Natural Antique Copper | 1100 × 1100 × 420 | 1100 mm | 0.87 |
| table | `abo-B07QC85TNQ` | Stone & Beam Side Table with Drawer, 19"W, Ash Veneer, Walnut and Antique Bronze Finish | 483 × 400 × 610 | 483 mm W | 0.51 |

## The office batch (2026-09-20)

28 more products, 18.6 MB, for the tower's office floors: 10 desks, 4 file cabinets, 2 sideboards, 5 dining tables (meeting tables; the label stays), 3 desk lamps, 1 bookcase and **3 office chairs**, every office chair that passes the gates. The batch took about two and a half minutes and nothing was refused. Five models needed the simplify ladder: the three office chairs (22,707, 24,144 and 9,784 triangles), the bookcase that had been refused at 30,581, and the rolling file cabinet. With the living-room batch that is 79 ABO products.

| Category | Listing | Title | w × d × h, mm | Title confirms | Simplify error | MB |
| --- | --- | --- | --- | --- | --- | --- |
| chair | `abo-B082BL8QJM` | Rivet Bertha Mid-Century Velvet-Upholstered Swivel Office Chair, 25.25"W, Sapphire Blue with Chrome Finish | 641 × 635 × 908 | 641 mm W | 0.0003 | 1.38 |
| chair | `abo-B082BLFMRC` | Rivet Celine Upholstered Home Office Task Chair, 22.25"W, Beige | 565 × 667 × 952 | 565 mm W | 0.0003 | 1.33 |
| chair | `abo-B082BM2BC1` | Rivet Modern Upholstered Swivel Home Office Task Chair, 25.5"W, Ash Gray with Nickel Finish | 648 × 654 × 959 | 648 mm W | 0.001 | 1.17 |
| desk | `abo-B07R7W7ZMP` | AmazonBasics Wooden, Home Office, Computer Study Desk with Drawer, 39 Inch, White | 991 × 499 × 762 | 991 mm | default | 0.15 |
| desk | `abo-B07QHKQLBH` | Ravenna Home Classic Two-Drawer Desk, 44"W, Walnut | 1118 × 508 × 762 | 1118 mm W | default | 0.73 |
| desk | `abo-B07QF9Y6Z9` | Rivet Classic Desk, 37.4"W, Walnut | 950 × 590 × 760 | 950 mm W | default | 0.79 |
| desk | `abo-B07QC84LRJ` | Rivet Industrial Desk Table, 51.18"W, Espresso | 1300 × 600 × 780 | 1300 mm W | default | 0.59 |
| desk | `abo-B07QGFS4JC` | Rivet Mid-Century Desk, 42"W, Warm Brown Wood with Veneer | 1067 × 660 × 754 | 1067 mm W | default | 0.52 |
| desk | `abo-B07HSCYS4C` | Rivet Modern 3-Drawer Desk, 51.9"W, White | 1318 × 607 × 762 | 1318 mm W | default | 0.16 |
| desk | `abo-B07HSJDN75` | Rivet Modern Computer Desk, 30"H, Walnut and White | 1067 × 399 × 762 | 762 mm H | default | 0.12 |
| desk | `abo-B075ZBW1SN` | Rivet Ventura Mid-Century Small Reversible Writing Home Office Computer Desk with File Drawer, 50"W, Cherry | 1270 × 610 × 762 | 1270 mm W | default | 0.17 |
| desk | `abo-B07QC85X9J` | Stone & Beam Classic Home Office Desk with Drawer, 54"W, Dark Espresso | 1372 × 597 × 762 | 1372 mm W | default | 0.57 |
| desk | `abo-B082JJJKT3` | Stone & Beam Modern Home Office Writing Desk with Recessed Metal Handles, 48"W, Black | 1219 × 508 × 775 | 1219 mm W | default | 0.29 |
| lamp | `abo-B0824F6HZ4` | Ravenna Home Traditional Metal Downbridge Desk Lamp with Adjustable Shade, LED Bulb Included, 19.25"H, Brushed Nickel | 178 × 330 × 489 | 489 mm H | default | 0.50 |
| lamp | `abo-B07374VCVN` | Rivet Copper Geometric Bedside Table Desk Lamp With Light Bulb - 16.75 Inches, Copper | 292 × 292 × 427 | 425 mm | default | 0.69 |
| lamp | `abo-B073751DMJ` | Rivet Gold Bedside Table Desk Lamp with Light Bulb - 18 Inches, Linen Shade | 254 × 254 × 457 | 457 mm | default | 0.59 |
| shelf | `abo-B07QC85X9C` | Ravenna Home Springdale Modern Bookcase with Decorative Open Sides, 30"W, White | 762 × 342 × 1829 | 762 mm W | 0.0003 | 0.47 |
| storage | `abo-B082JGPBLQ` | Stone & Beam 2-Drawer Rolling File Cabinet, 15.8"W, Maple Finish | 409 × 401 × 579 | 401 mm W | 0.0003 | 1.30 |
| storage | `abo-B082L1FGYP` | Stone & Beam Classic 2-Drawer Lateral File Cabinet, Pine with Metal Hardware, 30"H, Maple-Sand Finish | 762 × 503 × 762 | 762 mm H | default | 1.39 |
| storage | `abo-B075YQXQ5C` | Stone & Beam Dunbar Modern Wood Buffet, 55"W, Oak | 1397 × 483 × 914 | 1397 mm W | default | 0.78 |
| storage | `abo-B082JH6LSF` | Stone & Beam Mid-Century 2-Drawer File Cabinet, 21.7"W, Pine Finish | 551 × 391 × 599 | 551 mm W | default | 1.16 |
| storage | `abo-B082L28P18` | Stone & Beam Modern 2-Drawer File Cabinet with Recessed Metal Handles, 28.5"H, White | 521 × 432 × 724 | 724 mm H | default | 0.26 |
| storage | `abo-B07HSLVMP2` | Stone & Beam Rylee Modern Acacia Wood 3-Drawer Sideboard Buffet, 63"W, Acacia, Gray-Wash Acacia | 1600 × 450 × 800 | 1600 mm W | default | 0.56 |
| table | `abo-B07QGWMTDY` | Rivet Fulton Modern Rustic Dining Table, 71"L, Natural | 1803 × 991 × 762 | 1803 mm L | default | 1.19 |
| table | `abo-B07B78LZQC` | Rivet Ian Modern Wood Round Dining Room Kitchen Table, 42"W, Brown | 1067 × 1067 × 762 | 1067 mm W | default | 0.67 |
| table | `abo-B075YQXRJM` | Rivet Mid-Century Modern Minimalist Dining Kitchen Table, 53.1"L, Walnut Wood | 1349 × 800 × 724 | 1349 mm L | default | 0.24 |
| table | `abo-B07HSJJF2X` | Stone & Beam Industrial Mango Wood Rectangle Dining Table, 71"L, Black Metal Legs | 1801 × 899 × 765 | 1803 mm L | default | 0.38 |
| table | `abo-B07B7BM55W` | Stone & Beam Reclaimed Fir Rustic Wood Dining Kitchen Table, 78.8"L, Brown | 2000 × 950 × 759 | 2002 mm L | default | 0.47 |
