# Zork I story build

The shipped `src/zork1-z3.w3mi.data.z3` is rebuilt from the MIT-licensed ZIL source at [historicalsource/zork1 commit 97b7b3d68c075dd9af7da499c3e9690ada3471fd](https://github.com/historicalsource/zork1/tree/97b7b3d68c075dd9af7da499c3e9690ada3471fd). It is **not** the repository's `COMPILED/zork1.z3` or `zork1.zip`.

Toolchain: [ZILF/ZAPF 1.9.0 Linux x64 release](https://github.com/taradinoc/zilf/releases/tag/1.9), artifact `https://github.com/taradinoc/zilf/releases/download/1.9/zilf-1.9.0-linux-x64.tar.gz`, SHA-256 `06ff0e59eff6e6896fd9ce71d16c100365abbc537cf030f2bd31beb9384d0155`. The compiler and assembler binaries are build tools and are not shipped.

```sh
git clone --depth 1 https://github.com/historicalsource/zork1.git /tmp/zorkmit-zork1
git -C /tmp/zorkmit-zork1 fetch --depth 1 origin 97b7b3d68c075dd9af7da499c3e9690ada3471fd
git -C /tmp/zorkmit-zork1 checkout --detach 97b7b3d68c075dd9af7da499c3e9690ada3471fd
curl -L --fail https://github.com/taradinoc/zilf/releases/download/1.9/zilf-1.9.0-linux-x64.tar.gz -o /tmp/zorkmit-zilf-1.9.tar.gz
echo '06ff0e59eff6e6896fd9ce71d16c100365abbc537cf030f2bd31beb9384d0155  /tmp/zorkmit-zilf-1.9.tar.gz' | sha256sum -c -
mkdir -p /tmp/zorkmit-zilf-bin /tmp/zorkmit-build
tar -xzf /tmp/zorkmit-zilf-1.9.tar.gz -C /tmp/zorkmit-zilf-bin
cp /tmp/zorkmit-zork1/*.zil /tmp/zorkmit-zork1/*.xzap /tmp/zorkmit-build/
cd /tmp/zorkmit-build
/tmp/zorkmit-zilf-bin/zilf-1.9.0-linux-x64/bin/zilf zork1.zil
/tmp/zorkmit-zilf-bin/zilf-1.9.0-linux-x64/bin/zapf zork1.zap zork1-repro.z3 -r 1 -s 000001
sha256sum zork1-repro.z3
```

The `-r` and `-s` options fix the header release and serial metadata. Output: **86,928 bytes**, SHA-256 **`140fc6e4664cfe66928e49dded68f3bea150356d6f3bd6a9690de9390c3f0811`**. Two fresh builds in separate empty build directories were byte-identical (`cmp` and SHA-256). Run `node scripts/zork-story-check.mjs` to check the committed bytes offline.

## Library license audit

At the ZILF 1.9 tag (`3540f3aee958f2f2f0e176405615a8a6cd3b38b9`), `zillib/LICENSE.txt` is a permissive library license with binary notice conditions. `LICENSE.RTL.txt` is a separate permissive license for compiler-injected Glulx and Cornerstone runtime routines. Zork I's `zork1.zil` has nine `INSERT-FILE` statements, all resolving to `.zil` files copied from the pinned Zork I source tree (`GMACROS`, `GSYNTAX`, `1DUNGEON`, `GGLOBALS`, `GCLOCK`, `GMAIN`, `GPARSER`, `GVERBS`, `1ACTIONS`). The ZILF compile log refers to those local files and reports no zillib input. The target is Z-machine v3, so the Glulx/Cornerstone RTL routines do not apply. No ZILF-licensed library or RTL code is copied into this story; no additional ZILF library notice is required. ZILF/ZAPF themselves are GPLv3 build tools, not distributed in the pack.

The shipped Zork I source grant is the Microsoft MIT license in `ZORK1-LICENSE.txt` and in generated `THIRD-PARTY-NOTICES.md`. This release grants no trademark rights.
