# Bibliothèques tierces embarquées (aucun CDN à l'exécution)

| Fichier | Paquet npm | Version | Fichier d'origine dans le paquet | Licence | sha256 |
|---|---|---|---|---|---|
| `three.module.js` | three | 0.170.0 (r170) | `build/three.module.js` | MIT | `ce1fa418de16a19495a9f72495580e3015d7745c296d3ce0485897f902ddedfb` |
| `OrbitControls.js` | three | 0.170.0 (r170) | `examples/jsm/controls/OrbitControls.js` | MIT | `80efaadea4f8a636a65fb0bd08bfef62f3d93a0bb94e2e7500f23176c5c07f4e` |
| `astronomy.js` | astronomy-engine | 2.1.19 | `esm/astronomy.js` | MIT | `068f1445ed0c636c94818fe6d20d7d125120e605e0bab9fc4675c3d531be5ad7` |

Fichiers copiés sans modification depuis les archives officielles du registre npm
(`npm pack three@0.170.0`, `npm pack astronomy-engine@2.1.19`, récupérées le 2026-11-15 UTC) :

- three-0.170.0.tgz : sha256 `4a608a355dcaba72e0e5383cdc814303f5b6060b43c238cdf6932dceb699238d`
- astronomy-engine-2.1.19.tgz : sha256 `605e9e9ebd0a364f1c5b556f10c1f163e4b8aa63b97ada1ab72e960d73189cdd`

Import : `three.module.js` (r170) est autonome (pas de `three.core.js`, apparu en r171).
`OrbitControls.js` importe depuis `'three'` : prévoir l'importmap
`{"imports": {"three": "./vendor/three.module.js"}}`.
`astronomy.js` est un module ES sans dépendance (`import * as Astronomy from './vendor/astronomy.js'`).

## three.js — https://github.com/mrdoob/three.js

```
The MIT License

Copyright © 2010-2024 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## astronomy-engine — https://github.com/cosinekitty/astronomy

Le paquet npm ne contient pas de fichier LICENSE séparé ; sa licence (MIT) figure dans
`package.json` et dans l'en-tête de `astronomy.js` (conservé). Texte du dépôt :

```
MIT License

Copyright (c) 2019-2025 Don Cross <cosinekitty@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
