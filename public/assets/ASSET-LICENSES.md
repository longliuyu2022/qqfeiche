# Third-party vehicle asset

## Car Concept (`CarConcept.glb`)

- Source: KhronosGroup glTF Sample Assets, `Models/CarConcept/glTF-Binary/CarConcept.glb`
- Repository: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept
- Direct source file: https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/glTF-Binary/CarConcept.glb
- Retrieved: 2026-08-07
- SHA-256: `c272098089d78c5cd9fd9f24ff50ee8acf8d932c55f2d55fc10adb6c8998966b`
- Asset author: Eric Chadwick, Darmstadt Graphics Group GmbH, 2024
- Asset license: Creative Commons Attribution 4.0 International (`CC-BY-4.0`)
- License text: https://creativecommons.org/licenses/by/4.0/legalcode
- Upstream license notice: https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/Models/CarConcept/LICENSE.md

Required attribution: "Car Concept" by Eric Chadwick of Darmstadt Graphics
Group GmbH, used under CC BY 4.0.

The asset contains Khronos and 3D Commerce logos. Those marks retain their
upstream `LicenseRef-LegalMark-Khronos` terms and are not endorsements of this
project. See the upstream license notice before redistributing a modified asset.

# Third-party environment assets

The optimized environment GLB files under `environment/models/` are derived
from Poly Haven source models. Poly Haven publishes these models and textures
under CC0 1.0; the files were downloaded as 1K glTF sources, simplified into
near/mid/far LODs with glTF-Transform, and compressed with Meshopt/WebP for
browser delivery. The authoring `.bin` files are intentionally not shipped.

| Asset | Source | License | Published levels |
| --- | --- | --- | --- |
| mountainside | https://polyhaven.com/a/mountainside | CC0 1.0 | near / mid / far |
| boulder_01 | https://polyhaven.com/a/boulder_01 | CC0 1.0 | near / mid / far |
| modular_urban_apartments_facade | https://polyhaven.com/a/modular_urban_apartments_facade | CC0 1.0 | near / mid / far |
| modular_factory_facade | https://polyhaven.com/a/modular_factory_facade | CC0 1.0 | near / mid / far |
| fir_sapling | https://polyhaven.com/a/fir_sapling | CC0 1.0 | near / mid / far |

The runtime loader tags these nodes with `bakedLighting: true` and enables
vertex/AO-ready material handling. Scene lights remain dynamic for weather and
vehicle effects; no claim is made that these assets contain offline lightmap
textures.
