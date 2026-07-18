# Base Image and Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a bootable x86-64 UEFI preview ISO based on Ubuntu 26.04 LTS with KDE Plasma, a branded Calamares installer, a Btrfs/Snapper layout, pre-update snapshots, and offline root recovery from the live environment.

**Architecture:** `live-build` produces a reproducible Ubuntu live ISO from tracked package lists, filesystem overlays, and hooks. Calamares installs the live root into a Btrfs subvolume layout; a small set of distribution-owned shell utilities configures Snapper, creates snapshots before package changes, and restores the root subvolume only from the unmounted live environment. All distribution-specific behavior stays under the `ru-desktop` namespace and is tested with Bats, ShellCheck, YAML parsing, and a QEMU UEFI boot smoke test.

**Tech Stack:** Ubuntu 26.04 LTS, live-build, KDE Plasma, Calamares 3.3, Btrfs, Snapper, Bash 5, Bats, ShellCheck, Python 3 with PyYAML, QEMU, OVMF, Docker or Podman.

## Global Constraints

- Base operating system: Ubuntu 26.04 LTS.
- Desktop: KDE Plasma through the `kubuntu-desktop` metapackage.
- Default filesystem: Btrfs with `@`, `@home`, `@snapshots`, and `@swap` subvolumes.
- Installer: Calamares using the Ubuntu 26.04 `calamares-settings-kubuntu` package as the upstream baseline.
- System packages: APT only; this plan does not introduce a new package format.
- Supported release architecture: x86-64 with UEFI.
- The internal preview identity is `ru-desktop`, display name `RU Desktop Preview`, version `0.1`; public naming is outside this plan.
- Telemetry and Calamares tracking remain disabled.
- Proprietary applications and third-party repositories are not included.
- No file under `sources/` may be edited.
- Shell utilities must pass `shellcheck`; YAML must parse with `python3-yaml`.
- Every destructive recovery action requires an explicit `RESTORE` confirmation unless the caller passes `--yes` from an automated test.
- Execute the plan in an isolated Git worktree; the parent repository contains unrelated staged user changes that must not enter any task commit.

---

## Scope and File Map

This is the first of six implementation plans from the product specification. It deliberately excludes Welcome, App Catalog, Compatibility Center, Developer Center, AI, Yandex Disk, and electronic-signature integration. A follow-up release-engineering plan will package the distribution-owned files, create the signed project APT repository, promote `testing` and `stable` channels, and generate SBOM artifacts; this private preview consumes only Ubuntu's signed repositories.

The implementation creates this structure:

```text
.
├── .gitignore
├── Containerfile.builder
├── Makefile
├── auto/
│   └── config
├── config/
│   ├── hooks/live/
│   │   └── 010-enable-services.hook.chroot
│   ├── includes.chroot/
│   │   ├── etc/
│   │   │   ├── apt/apt.conf.d/80ru-desktop-snapshot
│   │   │   ├── calamares/
│   │   │   │   ├── branding/ru-desktop/branding.desc
│   │   │   │   ├── branding/ru-desktop/logo.svg
│   │   │   │   ├── modules/mount.conf
│   │   │   │   ├── modules/partition.conf
│   │   │   │   ├── modules/shellprocess_ru_cleanup.conf
│   │   │   │   ├── modules/shellprocess_ru_snapper.conf
│   │   │   │   └── settings.conf
│   │   │   ├── default/snapper
│   │   │   ├── os-release
│   │   │   ├── snapper/configs/root
│   │   │   └── systemd/system/ru-live-ready.service
│   │   ├── usr/
│   │   │   ├── lib/ru-desktop/
│   │   │   │   ├── configure-snapper
│   │   │   │   ├── post-apt-snapshot
│   │   │   │   └── pre-apt-snapshot
│   │   │   ├── local/sbin/ru-recover-root
│   │   │   └── share/applications/ru-desktop-install.desktop
│   └── package-lists/
│       └── desktop.list.chroot
├── docs/
│   ├── build-and-recovery.md
│   └── superpowers/
├── scripts/
│   ├── build-iso.sh
│   ├── builder.sh
│   ├── check-host.sh
│   └── smoke-iso.sh
└── tests/
    ├── calamares_config.bats
    ├── configure_snapper.bats
    ├── iso_config.bats
    ├── recovery_loopback.bats
    ├── repository_layout.bats
    ├── restore_root.bats
    └── update_snapshot.bats
```

File responsibilities:

- `Containerfile.builder` pins the build and test environment to Ubuntu 26.04.
- `auto/config` is the single source of `lb config` options.
- `config/package-lists/desktop.list.chroot` is the auditable package manifest.
- `config/includes.chroot/` is copied verbatim into the live and installed systems.
- `config/hooks/live/` performs only build-time enablement that cannot be represented as a file overlay.
- `configure-snapper` owns first-install snapshot setup.
- `pre-apt-snapshot` and `post-apt-snapshot` own APT transaction snapshots.
- `ru-recover-root` is the only component allowed to replace the `@` root subvolume.
- `scripts/` contains host/build orchestration and never runs inside the installed system.
- `tests/` contains fast structural and mocked behavior tests; the final task adds the real UEFI boot test.

---

### Task 1: Reproducible Builder and Test Harness

**Files:**
- Create: `.gitignore`
- Create: `Containerfile.builder`
- Create: `Makefile`
- Create: `scripts/check-host.sh`
- Create: `scripts/builder.sh`
- Test: `tests/repository_layout.bats`

**Interfaces:**
- Consumes: Docker or Podman available on the developer host.
- Produces: `./scripts/builder.sh <make-target>` and Make targets `test`, `lint`, `iso`, `smoke`, and `verify`.

- [ ] **Step 1: Write the failing repository-layout test**

```bash
#!/usr/bin/env bats

@test "builder files and required make targets exist" {
    test -f Containerfile.builder
    test -x scripts/check-host.sh
    test -x scripts/builder.sh

    run make -n verify
    [ "$status" -eq 0 ]
    [[ "$output" == *"lint"* ]]
    [[ "$output" == *"test"* ]]
}

@test "builder image is based on Ubuntu 26.04" {
    run grep -Fx "FROM ubuntu:26.04" Containerfile.builder
    [ "$status" -eq 0 ]
}
```

- [ ] **Step 2: Run the test and verify the scaffold is absent**

Run:

```bash
bats tests/repository_layout.bats
```

Expected: FAIL because `Containerfile.builder`, `scripts/check-host.sh`, and `scripts/builder.sh` do not exist.

- [ ] **Step 3: Add the builder files**

Create `.gitignore`:

```gitignore
/build/
/.build-state/
/config/bootstrap
/config/binary
/config/chroot
/config/common
/config/source
*.iso
*.log
```

Create `Containerfile.builder`:

```dockerfile
FROM ubuntu:26.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        bats \
        bats-assert \
        bats-support \
        btrfs-progs \
        ca-certificates \
        debootstrap \
        dosfstools \
        genisoimage \
        git \
        grub-common \
        grub-efi-amd64-bin \
        grub-pc-bin \
        isolinux \
        live-build \
        mtools \
        make \
        ovmf \
        python3 \
        python3-yaml \
        qemu-system-x86 \
        shellcheck \
        squashfs-tools \
        syslinux \
        syslinux-common \
        util-linux \
        xorriso \
    && apt-get clean \
    && find /var/lib/apt/lists -mindepth 1 -delete

WORKDIR /workspace
ENTRYPOINT ["make"]
```

Create `Makefile`:

```make
SHELL := /bin/bash
ISO := build/ru-desktop-preview-0.1-amd64.iso
SHELL_FILES := $(shell find scripts config/hooks config/includes.chroot/usr/lib/ru-desktop config/includes.chroot/usr/local/sbin -type f 2>/dev/null)

.PHONY: check-host lint test configure iso smoke verify clean

check-host:
	./scripts/check-host.sh

lint:
	shellcheck $(SHELL_FILES)
	python3 -c 'import pathlib,yaml; [yaml.safe_load(p.read_text()) for p in pathlib.Path("config/includes.chroot/etc/calamares").rglob("*.conf")]'
	python3 -c 'import pathlib,yaml; p=pathlib.Path("config/includes.chroot/etc/calamares/branding/ru-desktop/branding.desc"); yaml.safe_load(p.read_text()) if p.exists() else None'

test:
	bats tests

configure:
	./auto/config

iso:
	./scripts/build-iso.sh "$(ISO)"

smoke:
	@if [[ ! -s "$(ISO)" ]]; then $(MAKE) iso; fi
	./scripts/smoke-iso.sh "$(ISO)"

verify: lint test

clean:
	lb clean --purge
```

Create `scripts/check-host.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

missing_commands() {
    local command_name
    for command_name in "$@"; do
        if ! command -v "$command_name" >/dev/null 2>&1; then
            printf '%s\n' "$command_name"
        fi
    done
}

main() {
    local missing
    missing="$(missing_commands bats grub-mkrescue lb make python3 qemu-system-x86_64 shellcheck xorriso)"
    if [[ -n "$missing" ]]; then
        printf 'Missing required commands:\n%s\n' "$missing" >&2
        return 1
    fi

    if [[ "${EUID}" -ne 0 ]]; then
        printf 'ISO builds must run as root inside the builder container.\n' >&2
        return 1
    fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
```

Create `scripts/builder.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

engine="${CONTAINER_ENGINE:-}"
if [[ -z "$engine" ]]; then
    if command -v podman >/dev/null 2>&1; then
        engine="podman"
    elif command -v docker >/dev/null 2>&1; then
        engine="docker"
    else
        printf 'Install Docker or Podman before running the builder.\n' >&2
        exit 1
    fi
fi

image="ru-desktop-builder:26.04"
if [[ "$#" -eq 0 ]]; then
    set -- verify
fi
"$engine" build --tag "$image" --file Containerfile.builder .
"$engine" run \
    --rm \
    --privileged \
    --volume "$PWD:/workspace" \
    "$image" \
    "$@"
```

Make both scripts executable:

```bash
chmod +x scripts/check-host.sh scripts/builder.sh
```

- [ ] **Step 4: Run the layout test and full static verification**

Run:

```bash
bats tests/repository_layout.bats
make -n verify
```

Expected: 2 Bats tests PASS; `make -n verify` prints the future lint and test commands without errors.

- [ ] **Step 5: Commit the builder scaffold**

```bash
git add .gitignore Containerfile.builder Makefile scripts/check-host.sh scripts/builder.sh tests/repository_layout.bats
git commit -m "build: add reproducible Ubuntu 26.04 builder"
```

---

### Task 2: Live-Build Configuration and Package Manifest

**Files:**
- Create: `auto/config`
- Create: `config/package-lists/desktop.list.chroot`
- Create: `scripts/build-iso.sh`
- Test: `tests/iso_config.bats`

**Interfaces:**
- Consumes: `check-host` from Task 1.
- Produces: `build/ru-desktop-preview-0.1-amd64.iso`.

- [ ] **Step 1: Write the failing ISO-configuration tests**

```bash
#!/usr/bin/env bats

@test "live-build targets Ubuntu Resolute amd64 hybrid ISO" {
    run grep -F -- "--distribution resolute" auto/config
    [ "$status" -eq 0 ]
    run grep -F -- "--architectures amd64" auto/config
    [ "$status" -eq 0 ]
    run grep -F -- "--binary-images iso-hybrid" auto/config
    [ "$status" -eq 0 ]
    run grep -F -- "--bootloader grub2" auto/config
    [ "$status" -eq 0 ]
    run grep -F -- "--initramfs casper" auto/config
    [ "$status" -eq 0 ]
}

@test "desktop manifest contains the required platform packages" {
    for package in \
        btrfs-progs \
        calamares-settings-kubuntu \
        casper \
        flatpak \
        language-pack-kde-ru \
        language-pack-ru \
        kubuntu-desktop \
        plasma-discover-backend-flatpak \
        snapper; do
        run grep -Fx "$package" config/package-lists/desktop.list.chroot
        [ "$status" -eq 0 ]
    done
}

@test "build script refuses to run outside root builder" {
    run env RU_DESKTOP_TEST_EUID=1000 scripts/build-iso.sh build/test.iso
    [ "$status" -eq 1 ]
    [[ "$output" == *"root inside the builder container"* ]]
}

@test "final ISO is regenerated with GRUB UEFI support" {
    run grep -F "grub-mkrescue" scripts/build-iso.sh
    [ "$status" -eq 0 ]
}
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
bats tests/iso_config.bats
```

Expected: FAIL because `auto/config`, the package manifest, and `scripts/build-iso.sh` do not exist.

- [ ] **Step 3: Add the live-build configuration**

Create executable `auto/config`:

```bash
#!/usr/bin/env bash
set -euo pipefail

lb config noauto \
    --mode ubuntu \
    --distribution resolute \
    --architectures amd64 \
    --binary-images iso-hybrid \
    --bootloader grub2 \
    --initramfs casper \
    --archive-areas "main restricted universe multiverse" \
    --linux-flavours generic \
    --apt-recommends true \
    --bootappend-live "boot=casper components quiet splash username=live hostname=ru-desktop-live locales=ru_RU.UTF-8 keyboard-layouts=us,ru" \
    --iso-application "RU Desktop Preview" \
    --iso-publisher "RU Desktop Project" \
    --iso-volume "RU_DESKTOP_01"
```

Create `config/package-lists/desktop.list.chroot`:

```text
btrfs-progs
calamares
calamares-settings-kubuntu
casper
flatpak
hunspell-ru
kubuntu-desktop
language-pack-kde-ru
language-pack-ru
network-manager
plasma-discover
plasma-discover-backend-flatpak
snapper
xfsprogs
```

Create executable `scripts/build-iso.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

output="${1:-build/ru-desktop-preview-0.1-amd64.iso}"
effective_uid="${RU_DESKTOP_TEST_EUID:-$EUID}"

if [[ "$effective_uid" -ne 0 ]]; then
    printf 'ISO builds must run as root inside the builder container.\n' >&2
    exit 1
fi

./scripts/check-host.sh
./auto/config
lb build

if [[ ! -d binary/casper ]] || ! compgen -G "binary/casper/vmlinuz-*" >/dev/null; then
    printf 'live-build did not create a Casper live filesystem.\n' >&2
    exit 1
fi

install -d "$(dirname "$output")"
grub-mkrescue --output="$output" binary
sha256sum "$output" > "${output}.sha256"
printf 'Built %s\n' "$output"
```

Make the files executable:

```bash
chmod +x auto/config scripts/build-iso.sh
```

- [ ] **Step 4: Run tests and configuration generation**

Run:

```bash
bats tests/iso_config.bats
sudo ./auto/config
test -f config/bootstrap
```

Expected: 4 Bats tests PASS and `config/bootstrap` exists.

- [ ] **Step 5: Commit live-build configuration**

```bash
git add auto/config config/package-lists/desktop.list.chroot scripts/build-iso.sh tests/iso_config.bats
git commit -m "build: configure Ubuntu KDE live image"
```

---

### Task 3: Preview Identity, Installer Launcher, and Boot Marker

**Files:**
- Create: `config/includes.chroot/etc/os-release`
- Create: `config/includes.chroot/usr/share/applications/ru-desktop-install.desktop`
- Create: `config/includes.chroot/etc/systemd/system/ru-live-ready.service`
- Create: `config/hooks/live/010-enable-services.hook.chroot`
- Modify: `tests/iso_config.bats`

**Interfaces:**
- Consumes: live filesystem overlay from Task 2.
- Produces: stable OS identity fields, an installer launcher, and serial marker `RU_DESKTOP_LIVE_READY`.

- [ ] **Step 1: Extend the failing structural tests**

Append to `tests/iso_config.bats`:

```bash
@test "preview identity is stable and declares Ubuntu compatibility" {
    release_file="config/includes.chroot/etc/os-release"
    run grep -Fx "ID=ru-desktop" "$release_file"
    [ "$status" -eq 0 ]
    run grep -Fx 'ID_LIKE="ubuntu debian"' "$release_file"
    [ "$status" -eq 0 ]
    run grep -Fx 'VERSION_ID="0.1"' "$release_file"
    [ "$status" -eq 0 ]
}

@test "live session exposes installer and readiness marker" {
    run grep -F "Exec=calamares-launch-normal" \
        config/includes.chroot/usr/share/applications/ru-desktop-install.desktop
    [ "$status" -eq 0 ]
    run grep -F "RU_DESKTOP_LIVE_READY" \
        config/includes.chroot/etc/systemd/system/ru-live-ready.service
    [ "$status" -eq 0 ]
}
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run:

```bash
bats tests/iso_config.bats
```

Expected: the two new tests FAIL because the overlay files do not exist.

- [ ] **Step 3: Add identity and live-session files**

Create `config/includes.chroot/etc/os-release`:

```ini
PRETTY_NAME="RU Desktop Preview 0.1"
NAME="RU Desktop Preview"
VERSION_ID="0.1"
VERSION="0.1 (Ubuntu 26.04 LTS base)"
VERSION_CODENAME=resolute
ID=ru-desktop
ID_LIKE="ubuntu debian"
UBUNTU_CODENAME=resolute
```

Support URLs are intentionally omitted from the private preview. A later public-release plan adds them only after the project owns a production domain.

Create `config/includes.chroot/usr/share/applications/ru-desktop-install.desktop`:

```ini
[Desktop Entry]
Type=Application
Name=Install RU Desktop Preview
Name[ru]=Установить RU Desktop Preview
Comment=Install the system on this computer
Comment[ru]=Установить систему на этот компьютер
Exec=calamares-launch-normal
Icon=calamares
Terminal=false
Categories=System;
```

Create `config/includes.chroot/etc/systemd/system/ru-live-ready.service`:

```ini
[Unit]
Description=Emit RU Desktop live readiness marker
After=display-manager.service
ConditionKernelCommandLine=boot=casper

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'printf "RU_DESKTOP_LIVE_READY\n" > /dev/ttyS0'

[Install]
WantedBy=graphical.target
```

Create executable `config/hooks/live/010-enable-services.hook.chroot`:

```bash
#!/usr/bin/env bash
set -euo pipefail

systemctl enable ru-live-ready.service
```

Run:

```bash
chmod +x config/hooks/live/010-enable-services.hook.chroot
```

- [ ] **Step 4: Run tests and lint**

Run:

```bash
bats tests/iso_config.bats
shellcheck config/hooks/live/010-enable-services.hook.chroot
```

Expected: all ISO-configuration tests PASS and ShellCheck reports no findings.

- [ ] **Step 5: Commit preview identity**

```bash
git add config/includes.chroot/etc/os-release \
    config/includes.chroot/usr/share/applications/ru-desktop-install.desktop \
    config/includes.chroot/etc/systemd/system/ru-live-ready.service \
    config/hooks/live/010-enable-services.hook.chroot \
    tests/iso_config.bats
git commit -m "feat: add preview live-session identity"
```

---

### Task 4: Calamares Branding and Btrfs Layout

**Files:**
- Create: `config/includes.chroot/etc/calamares/branding/ru-desktop/branding.desc`
- Create: `config/includes.chroot/etc/calamares/branding/ru-desktop/logo.svg`
- Create: `config/includes.chroot/etc/calamares/modules/partition.conf`
- Create: `config/includes.chroot/etc/calamares/modules/mount.conf`
- Create: `config/includes.chroot/etc/calamares/modules/shellprocess_ru_cleanup.conf`
- Create: `config/includes.chroot/etc/calamares/modules/shellprocess_ru_snapper.conf`
- Create: `config/includes.chroot/etc/calamares/settings.conf`
- Test: `tests/calamares_config.bats`

**Interfaces:**
- Consumes: modules and helper configurations installed by `calamares-settings-kubuntu`.
- Produces: Calamares brand `ru-desktop` and Btrfs subvolumes `@`, `@home`, `@snapshots`, and `@swap`; invokes `/usr/lib/ru-desktop/configure-snapper` before unmount.

- [ ] **Step 1: Write failing Calamares configuration tests**

```bash
#!/usr/bin/env bats

setup() {
    export CALAMARES_ROOT="config/includes.chroot/etc/calamares"
}

@test "all custom Calamares YAML parses" {
    run python3 - "$CALAMARES_ROOT" <<'PY'
import pathlib
import sys
import yaml

root = pathlib.Path(sys.argv[1])
files = list(root.rglob("*.conf")) + [root / "branding/ru-desktop/branding.desc"]
for path in files:
    yaml.safe_load(path.read_text())
print(f"parsed {len(files)} files")
PY
    [ "$status" -eq 0 ]
}

@test "automatic partitioning defaults to Btrfs" {
    run python3 - "$CALAMARES_ROOT/modules/partition.conf" <<'PY'
import sys
import yaml
data = yaml.safe_load(open(sys.argv[1]))
assert data["defaultFileSystemType"] == "btrfs"
assert data["availableFileSystemTypes"][0] == "btrfs"
PY
    [ "$status" -eq 0 ]
}

@test "mount configuration declares isolated snapshot subvolumes" {
    run python3 - "$CALAMARES_ROOT/modules/mount.conf" <<'PY'
import sys
import yaml
data = yaml.safe_load(open(sys.argv[1]))
pairs = {(x["mountPoint"], x["subvolume"]) for x in data["btrfsSubvolumes"]}
assert ("/", "/@") in pairs
assert ("/home", "/@home") in pairs
assert ("/.snapshots", "/@snapshots") in pairs
assert data["btrfsSwapSubvol"] == "/@swap"
PY
    [ "$status" -eq 0 ]
}

@test "snapper setup runs before Calamares unmount" {
    run python3 - "$CALAMARES_ROOT/settings.conf" <<'PY'
import sys
import yaml
data = yaml.safe_load(open(sys.argv[1]))
exec_sequence = data["sequence"][1]["exec"]
assert data["branding"] == "ru-desktop"
assert exec_sequence.index("shellprocess@ru_cleanup") < exec_sequence.index("shellprocess@ru_snapper")
assert exec_sequence.index("shellprocess@ru_snapper") < exec_sequence.index("umount")
PY
    [ "$status" -eq 0 ]
}
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
bats tests/calamares_config.bats
```

Expected: 4 tests FAIL because the custom Calamares files do not exist.

- [ ] **Step 3: Add branding and storage configuration**

Create `config/includes.chroot/etc/calamares/branding/ru-desktop/branding.desc`:

```yaml
---
componentName: ru-desktop
windowExpanding: fullscreen
strings:
  productName: RU Desktop Preview
  shortProductName: RU Desktop
  version: "0.1"
  shortVersion: "0.1"
  versionedName: RU Desktop Preview 0.1
  shortVersionedName: RU Desktop 0.1
  bootloaderEntryName: RU Desktop
images:
  productLogo: logo.svg
  productIcon: logo.svg
  productWelcome: logo.svg
style:
  SidebarBackground: "#162033"
  SidebarText: "#F7F9FC"
  SidebarTextCurrent: "#4DA3FF"
```

Create `config/includes.chroot/etc/calamares/branding/ru-desktop/logo.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="56" fill="#162033"/>
  <path d="M64 72h72c34 0 56 19 56 48 0 20-10 35-29 43l35 29h-48l-28-24H96v24H64V72zm32 32v32h39c16 0 25-6 25-16s-9-16-25-16H96z" fill="#F7F9FC"/>
  <circle cx="188" cy="72" r="16" fill="#4DA3FF"/>
</svg>
```

Create `config/includes.chroot/etc/calamares/modules/partition.conf`:

```yaml
---
efiSystemPartition: /boot/efi
efiSystemPartitionSize: 512MiB
enableLuksAutomatedPartitioning: true
luksGeneration: luks2
userSwapChoices:
  - none
  - file
initialSwapChoice: file
drawNestedPartitions: true
showNotEncryptedBootMessage: false
defaultFileSystemType: btrfs
availableFileSystemTypes:
  - btrfs
  - ext4
  - xfs
partitionLayout:
  - name: ru_desktop_boot
    filesystem: ext4
    noEncrypt: true
    onlyPresentWithEncryption: true
    mountPoint: /boot
    size: 1G
  - name: ru_desktop_root
    filesystem: unknown
    mountPoint: /
    size: 100%
```

Create `config/includes.chroot/etc/calamares/modules/mount.conf`:

```yaml
---
btrfsSwapSubvol: /@swap
btrfsSubvolumes:
  - mountPoint: /
    subvolume: /@
  - mountPoint: /home
    subvolume: /@home
  - mountPoint: /.snapshots
    subvolume: /@snapshots
mountOptions:
  - filesystem: default
    options:
      - defaults
  - filesystem: efi
    options:
      - defaults
      - umask=0077
  - filesystem: btrfs
    options:
      - defaults
      - noatime
      - compress=zstd:3
    ssdOptions:
      - discard=async
  - filesystem: btrfs_swap
    options:
      - defaults
      - noatime
  - filesystem: ext4
    options:
      - defaults
      - noatime
    ssdOptions:
      - discard
```

Create `config/includes.chroot/etc/calamares/modules/shellprocess_ru_snapper.conf`:

```yaml
---
dontChroot: false
timeout: 120
script:
  - /usr/lib/ru-desktop/configure-snapper
```

Create `config/includes.chroot/etc/calamares/modules/shellprocess_ru_cleanup.conf`:

```yaml
---
dontChroot: false
timeout: 30
script:
  - /usr/bin/rm -f /usr/share/applications/ru-desktop-install.desktop
  - /usr/bin/rm -f /etc/systemd/system/graphical.target.wants/ru-live-ready.service
```

- [ ] **Step 4: Add the complete Calamares module sequence**

Create `config/includes.chroot/etc/calamares/settings.conf`:

```yaml
---
modules-search:
  - local

instances:
  - id: before_bootloader_kerncopy
    module: shellprocess
    config: shellprocess_before_bootloader_kerncopy.conf
  - id: before_bootloader
    module: contextualprocess
    config: before_bootloader_context.conf
  - id: logs
    module: shellprocess
    config: shellprocess_logs.conf
  - id: bug-LP#1829805
    module: shellprocess
    config: shellprocess_bug-LP#1829805.conf
  - id: add386arch
    module: shellprocess
    config: shellprocess_add386arch.conf
  - id: fixconkeys_part1
    module: shellprocess
    config: shellprocess_fixconkeys_part1.conf
  - id: fixconkeys_part2
    module: shellprocess
    config: shellprocess_fixconkeys_part2.conf
  - id: pkgselect_action
    module: contextualprocess
    config: pkgselect_context.conf
  - id: pkgselect_snap_action
    module: contextualprocess
    config: pkgselect_snap_context.conf
  - id: rmcdrom
    module: shellprocess
    config: shellprocess_rmcdrom.conf
  - id: ru_snapper
    module: shellprocess
    config: shellprocess_ru_snapper.conf
  - id: ru_cleanup
    module: shellprocess
    config: shellprocess_ru_cleanup.conf

sequence:
  - show:
      - welcome
      - locale
      - keyboard
      - pkgselect
      - partition
      - users
      - summary
  - exec:
      - partition
      - mount
      - unpackfs
      - machineid
      - fstab
      - locale
      - keyboard
      - localecfg
      - luksbootkeyfile
      - users
      - displaymanager
      - networkcfg
      - hwclock
      - shellprocess@before_bootloader_kerncopy
      - shellprocess@bug-LP#1829805
      - shellprocess@fixconkeys_part1
      - shellprocess@fixconkeys_part2
      - initramfscfg
      - initramfs
      - grubcfg
      - contextualprocess@before_bootloader
      - bootloader
      - shellprocess@add386arch
      - automirror
      - packages
      - contextualprocess@pkgselect_action
      - contextualprocess@pkgselect_snap_action
      - shellprocess@rmcdrom
      - shellprocess@ru_cleanup
      - shellprocess@ru_snapper
      - shellprocess@logs
      - umount
  - show:
      - finished

branding: ru-desktop
prompt-install: true
dont-chroot: false
oem-setup: false
disable-cancel: false
disable-cancel-during-exec: false
```

- [ ] **Step 5: Run configuration tests and commit**

Run:

```bash
bats tests/calamares_config.bats
make lint
```

Expected: 4 tests PASS and all custom YAML parses.

Commit:

```bash
git add config/includes.chroot/etc/calamares tests/calamares_config.bats
git commit -m "feat: configure Calamares Btrfs installation"
```

---

### Task 5: Installed-System Snapper Provisioning

**Files:**
- Create: `config/includes.chroot/etc/default/snapper`
- Create: `config/includes.chroot/etc/snapper/configs/root`
- Create: `config/includes.chroot/usr/lib/ru-desktop/configure-snapper`
- Test: `tests/configure_snapper.bats`

**Interfaces:**
- Consumes: mounted Btrfs `@` and `@snapshots` subvolumes from Task 4.
- Produces: Snapper config `root`, enabled cleanup/timeline timers, and snapshot `Initial installation`.

- [ ] **Step 1: Write failing Snapper provisioning tests**

```bash
#!/usr/bin/env bats

setup() {
    export TEST_ROOT="$BATS_TEST_TMPDIR/root"
    export TEST_BIN="$BATS_TEST_TMPDIR/bin"
    mkdir -p "$TEST_ROOT/etc/default" "$TEST_ROOT/etc/snapper/configs" "$TEST_ROOT/.snapshots" "$TEST_BIN"

    cat > "$TEST_BIN/findmnt" <<'SH'
#!/usr/bin/env bash
printf 'btrfs\n'
SH
    cat > "$TEST_BIN/systemctl" <<'SH'
#!/usr/bin/env bash
printf 'systemctl %s\n' "$*" >> "$RU_DESKTOP_COMMAND_LOG"
SH
    cat > "$TEST_BIN/snapper" <<'SH'
#!/usr/bin/env bash
printf 'snapper %s\n' "$*" >> "$RU_DESKTOP_COMMAND_LOG"
SH
    chmod +x "$TEST_BIN"/*
}

@test "configure-snapper installs config and creates initial snapshot" {
    export RU_ROOT="$TEST_ROOT"
    export RU_DESKTOP_COMMAND_LOG="$BATS_TEST_TMPDIR/commands"
    export PATH="$TEST_BIN:$PATH"

    run config/includes.chroot/usr/lib/ru-desktop/configure-snapper
    [ "$status" -eq 0 ]
    grep -Fx 'SNAPPER_CONFIGS="root"' "$TEST_ROOT/etc/default/snapper"
    grep -Fx 'SUBVOLUME="/"' "$TEST_ROOT/etc/snapper/configs/root"
    grep -F 'systemctl enable snapper-cleanup.timer snapper-timeline.timer' "$RU_DESKTOP_COMMAND_LOG"
    grep -F 'snapper -c root create --description Initial installation' "$RU_DESKTOP_COMMAND_LOG"
}

@test "configure-snapper safely skips a non-Btrfs target" {
    cat > "$TEST_BIN/findmnt" <<'SH'
#!/usr/bin/env bash
printf 'ext4\n'
SH
    chmod +x "$TEST_BIN/findmnt"
    export RU_ROOT="$TEST_ROOT"
    export RU_DESKTOP_COMMAND_LOG="$BATS_TEST_TMPDIR/commands"
    export PATH="$TEST_BIN:$PATH"

    run config/includes.chroot/usr/lib/ru-desktop/configure-snapper
    [ "$status" -eq 0 ]
    [[ "$output" == *"Skipping Snapper setup for ext4 root"* ]]
    [ ! -e "$RU_DESKTOP_COMMAND_LOG" ]
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
bats tests/configure_snapper.bats
```

Expected: both tests FAIL because `configure-snapper` and the templates do not exist.

- [ ] **Step 3: Add Snapper configuration templates**

Create `config/includes.chroot/etc/default/snapper`:

```bash
SNAPPER_CONFIGS="root"
```

Create `config/includes.chroot/etc/snapper/configs/root`:

```ini
SUBVOLUME="/"
FSTYPE="btrfs"
QGROUP=""
SPACE_LIMIT="0.35"
FREE_LIMIT="0.20"
ALLOW_USERS=""
ALLOW_GROUPS="sudo"
SYNC_ACL="yes"
BACKGROUND_COMPARISON="yes"
NUMBER_CLEANUP="yes"
NUMBER_MIN_AGE="1800"
NUMBER_LIMIT="20"
NUMBER_LIMIT_IMPORTANT="10"
TIMELINE_CREATE="yes"
TIMELINE_CLEANUP="yes"
TIMELINE_MIN_AGE="1800"
TIMELINE_LIMIT_HOURLY="6"
TIMELINE_LIMIT_DAILY="7"
TIMELINE_LIMIT_WEEKLY="4"
TIMELINE_LIMIT_MONTHLY="6"
TIMELINE_LIMIT_YEARLY="0"
EMPTY_PRE_POST_CLEANUP="yes"
EMPTY_PRE_POST_MIN_AGE="1800"
```

- [ ] **Step 4: Implement Snapper provisioning**

Create executable `config/includes.chroot/usr/lib/ru-desktop/configure-snapper`:

```bash
#!/usr/bin/env bash
set -euo pipefail

root="${RU_ROOT:-}"
target_root="${root:-/}"
config_source="/etc/snapper/configs/root"

if [[ -n "$root" ]]; then
    config_source="$(dirname "$0")/../../../etc/snapper/configs/root"
fi

filesystem="$(findmnt --noheadings --output FSTYPE --target "$target_root" | tr -d '[:space:]')"
if [[ "$filesystem" != "btrfs" ]]; then
    printf 'Skipping Snapper setup for %s root.\n' "${filesystem:-unknown}"
    exit 0
fi

install -d -m 0755 "$target_root/etc/snapper/configs"
if [[ -n "$root" ]]; then
    install -m 0644 "$config_source" "$target_root/etc/snapper/configs/root"
elif [[ ! -f "$config_source" ]]; then
    printf 'Snapper root configuration is missing.\n' >&2
    exit 1
fi
printf 'SNAPPER_CONFIGS="root"\n' > "$target_root/etc/default/snapper"

systemctl enable snapper-cleanup.timer snapper-timeline.timer
snapper -c root create --description "Initial installation"
```

Run:

```bash
chmod +x config/includes.chroot/usr/lib/ru-desktop/configure-snapper
```

- [ ] **Step 5: Run tests, lint, and commit**

Run:

```bash
bats tests/configure_snapper.bats
shellcheck config/includes.chroot/usr/lib/ru-desktop/configure-snapper
```

Expected: 2 tests PASS and ShellCheck reports no findings.

Commit:

```bash
git add config/includes.chroot/etc/default/snapper \
    config/includes.chroot/etc/snapper/configs/root \
    config/includes.chroot/usr/lib/ru-desktop/configure-snapper \
    tests/configure_snapper.bats
git commit -m "feat: provision root snapshots after install"
```

---

### Task 6: Pre-Update Snapshot Guard

**Files:**
- Create: `config/includes.chroot/etc/apt/apt.conf.d/80ru-desktop-snapshot`
- Create: `config/includes.chroot/usr/lib/ru-desktop/pre-apt-snapshot`
- Create: `config/includes.chroot/usr/lib/ru-desktop/post-apt-snapshot`
- Test: `tests/update_snapshot.bats`

**Interfaces:**
- Consumes: Snapper config `root` from Task 5.
- Produces: one important snapshot per APT/dpkg transaction and runtime marker `/run/ru-desktop/apt-snapshot`.

- [ ] **Step 1: Write failing update-guard tests**

```bash
#!/usr/bin/env bats

setup() {
    export TEST_BIN="$BATS_TEST_TMPDIR/bin"
    export RU_DESKTOP_RUNTIME_DIR="$BATS_TEST_TMPDIR/run"
    export RU_DESKTOP_COMMAND_LOG="$BATS_TEST_TMPDIR/commands"
    mkdir -p "$TEST_BIN" "$RU_DESKTOP_RUNTIME_DIR"

    cat > "$TEST_BIN/findmnt" <<'SH'
#!/usr/bin/env bash
printf 'btrfs\n'
SH
    cat > "$TEST_BIN/snapper" <<'SH'
#!/usr/bin/env bash
printf 'snapper %s\n' "$*" >> "$RU_DESKTOP_COMMAND_LOG"
printf '42\n'
SH
    chmod +x "$TEST_BIN"/*
    export PATH="$TEST_BIN:$PATH"
}

@test "pre hook creates only one important snapshot per transaction" {
    run config/includes.chroot/usr/lib/ru-desktop/pre-apt-snapshot
    [ "$status" -eq 0 ]
    run config/includes.chroot/usr/lib/ru-desktop/pre-apt-snapshot
    [ "$status" -eq 0 ]

    [ "$(grep -c '^snapper ' "$RU_DESKTOP_COMMAND_LOG")" -eq 1 ]
    grep -Fx "42" "$RU_DESKTOP_RUNTIME_DIR/apt-snapshot"
}

@test "post hook removes the transaction marker" {
    printf '42\n' > "$RU_DESKTOP_RUNTIME_DIR/apt-snapshot"
    run config/includes.chroot/usr/lib/ru-desktop/post-apt-snapshot
    [ "$status" -eq 0 ]
    [ ! -e "$RU_DESKTOP_RUNTIME_DIR/apt-snapshot" ]
}

@test "APT configuration invokes both hooks" {
    file="config/includes.chroot/etc/apt/apt.conf.d/80ru-desktop-snapshot"
    grep -F 'DPkg::Pre-Invoke' "$file"
    grep -F 'DPkg::Post-Invoke' "$file"
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
bats tests/update_snapshot.bats
```

Expected: 3 tests FAIL because the hooks do not exist.

- [ ] **Step 3: Implement the pre- and post-transaction hooks**

Create executable `config/includes.chroot/usr/lib/ru-desktop/pre-apt-snapshot`:

```bash
#!/usr/bin/env bash
set -euo pipefail

runtime_dir="${RU_DESKTOP_RUNTIME_DIR:-/run/ru-desktop}"
marker="$runtime_dir/apt-snapshot"

install -d -m 0755 "$runtime_dir"
exec 9>"$runtime_dir/apt-snapshot.lock"
flock 9

if [[ -s "$marker" ]]; then
    exit 0
fi

filesystem="$(findmnt --noheadings --output FSTYPE --target / | tr -d '[:space:]')"
if [[ "$filesystem" != "btrfs" ]] || [[ ! -f /etc/snapper/configs/root && -z "${RU_DESKTOP_RUNTIME_DIR:-}" ]]; then
    exit 0
fi

snapshot_number="$(
    snapper -c root create \
        --type single \
        --cleanup-algorithm number \
        --userdata important=yes \
        --description "Before APT transaction" \
        --print-number
)"
printf '%s\n' "$snapshot_number" > "$marker"
```

Create executable `config/includes.chroot/usr/lib/ru-desktop/post-apt-snapshot`:

```bash
#!/usr/bin/env bash
set -euo pipefail

runtime_dir="${RU_DESKTOP_RUNTIME_DIR:-/run/ru-desktop}"
marker="$runtime_dir/apt-snapshot"

if [[ -e "$marker" ]]; then
    unlink "$marker"
fi
```

Create `config/includes.chroot/etc/apt/apt.conf.d/80ru-desktop-snapshot`:

```text
DPkg::Pre-Invoke { "/usr/lib/ru-desktop/pre-apt-snapshot"; };
DPkg::Post-Invoke { "/usr/lib/ru-desktop/post-apt-snapshot"; };
```

Run:

```bash
chmod +x \
    config/includes.chroot/usr/lib/ru-desktop/pre-apt-snapshot \
    config/includes.chroot/usr/lib/ru-desktop/post-apt-snapshot
```

- [ ] **Step 4: Run tests and lint**

Run:

```bash
bats tests/update_snapshot.bats
shellcheck \
    config/includes.chroot/usr/lib/ru-desktop/pre-apt-snapshot \
    config/includes.chroot/usr/lib/ru-desktop/post-apt-snapshot
```

Expected: 3 tests PASS and ShellCheck reports no findings.

- [ ] **Step 5: Commit the update guard**

```bash
git add config/includes.chroot/etc/apt/apt.conf.d/80ru-desktop-snapshot \
    config/includes.chroot/usr/lib/ru-desktop/pre-apt-snapshot \
    config/includes.chroot/usr/lib/ru-desktop/post-apt-snapshot \
    tests/update_snapshot.bats
git commit -m "feat: snapshot system before package updates"
```

---

### Task 7: Offline Root Recovery Tool

**Files:**
- Create: `config/includes.chroot/usr/local/sbin/ru-recover-root`
- Test: `tests/restore_root.bats`

**Interfaces:**
- Consumes: an unmounted Btrfs partition containing `@` and `@snapshots/<number>/snapshot`.
- Produces: backup subvolume `@failed-<UTC timestamp>` and a new writable `@` cloned from the selected snapshot.

- [ ] **Step 1: Write failing recovery behavior tests**

```bash
#!/usr/bin/env bats

setup() {
    export TEST_BIN="$BATS_TEST_TMPDIR/bin"
    export RU_RECOVERY_MOUNT="$BATS_TEST_TMPDIR/mount"
    export RU_DESKTOP_COMMAND_LOG="$BATS_TEST_TMPDIR/commands"
    mkdir -p "$TEST_BIN" "$RU_RECOVERY_MOUNT/@"
    mkdir -p "$RU_RECOVERY_MOUNT/@snapshots/17/snapshot"

    cat > "$TEST_BIN/findmnt" <<'SH'
#!/usr/bin/env bash
exit 1
SH
    cat > "$TEST_BIN/mount" <<'SH'
#!/usr/bin/env bash
printf 'mount %s\n' "$*" >> "$RU_DESKTOP_COMMAND_LOG"
SH
    cat > "$TEST_BIN/umount" <<'SH'
#!/usr/bin/env bash
printf 'umount %s\n' "$*" >> "$RU_DESKTOP_COMMAND_LOG"
SH
    cat > "$TEST_BIN/btrfs" <<'SH'
#!/usr/bin/env bash
printf 'btrfs %s\n' "$*" >> "$RU_DESKTOP_COMMAND_LOG"
SH
    chmod +x "$TEST_BIN"/*
    export PATH="$TEST_BIN:$PATH"
}

@test "recovery snapshots failed root before replacing it" {
    export RU_RECOVERY_TEST_EUID=0
    run config/includes.chroot/usr/local/sbin/ru-recover-root --yes /dev/test 17
    [ "$status" -eq 0 ]

    run grep -n '^btrfs subvolume' "$RU_DESKTOP_COMMAND_LOG"
    [ "$status" -eq 0 ]
    [[ "${lines[0]}" == *"snapshot $RU_RECOVERY_MOUNT/@ $RU_RECOVERY_MOUNT/@failed-"* ]]
    [[ "${lines[1]}" == *"delete $RU_RECOVERY_MOUNT/@"* ]]
    [[ "${lines[2]}" == *"snapshot $RU_RECOVERY_MOUNT/@snapshots/17/snapshot $RU_RECOVERY_MOUNT/@"* ]]
}

@test "recovery rejects a mounted source device" {
    cat > "$TEST_BIN/findmnt" <<'SH'
#!/usr/bin/env bash
printf '/mnt/in-use\n'
SH
    chmod +x "$TEST_BIN/findmnt"
    export RU_RECOVERY_TEST_EUID=0

    run config/includes.chroot/usr/local/sbin/ru-recover-root --yes /dev/test 17
    [ "$status" -eq 1 ]
    [[ "$output" == *"must not be mounted"* ]]
}

@test "recovery requires numeric snapshot id" {
    export RU_RECOVERY_TEST_EUID=0
    run config/includes.chroot/usr/local/sbin/ru-recover-root --yes /dev/test latest
    [ "$status" -eq 2 ]
    [[ "$output" == *"snapshot ID must be numeric"* ]]
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
bats tests/restore_root.bats
```

Expected: 3 tests FAIL because `ru-recover-root` does not exist.

- [ ] **Step 3: Implement guarded offline recovery**

Create executable `config/includes.chroot/usr/local/sbin/ru-recover-root`:

```bash
#!/usr/bin/env bash
set -euo pipefail

usage() {
    printf 'Usage: ru-recover-root [--yes] <btrfs-device> <snapshot-id>\n' >&2
}

assume_yes=false
if [[ "${1:-}" == "--yes" ]]; then
    assume_yes=true
    shift
fi

if [[ "$#" -ne 2 ]]; then
    usage
    exit 2
fi

device="$1"
snapshot_id="$2"
effective_uid="${RU_RECOVERY_TEST_EUID:-$EUID}"
mount_dir="${RU_RECOVERY_MOUNT:-}"
created_mount=false
mounted=false

if [[ "$effective_uid" -ne 0 ]]; then
    printf 'Recovery must run as root from the live environment.\n' >&2
    exit 1
fi

if [[ ! "$snapshot_id" =~ ^[0-9]+$ ]]; then
    printf 'The snapshot ID must be numeric.\n' >&2
    exit 2
fi

if findmnt --noheadings --source "$device" | grep -q .; then
    printf 'The recovery device must not be mounted: %s\n' "$device" >&2
    exit 1
fi

if [[ -z "$mount_dir" ]]; then
    mount_dir="$(mktemp -d /run/ru-recover.XXXXXX)"
    created_mount=true
fi

cleanup() {
    if [[ "$mounted" == true ]]; then
        umount "$mount_dir"
    fi
    if [[ "$created_mount" == true ]]; then
        rmdir "$mount_dir"
    fi
}
trap cleanup EXIT

mount -o subvolid=5 "$device" "$mount_dir"
mounted=true

current_root="$mount_dir/@"
snapshot="$mount_dir/@snapshots/$snapshot_id/snapshot"
if [[ ! -d "$current_root" ]]; then
    printf 'Current root subvolume @ was not found.\n' >&2
    exit 1
fi
if [[ ! -d "$snapshot" ]]; then
    printf 'Snapshot %s was not found.\n' "$snapshot_id" >&2
    exit 1
fi

if [[ "$assume_yes" != true ]]; then
    printf 'Replace @ with snapshot %s? Type RESTORE to continue: ' "$snapshot_id"
    read -r confirmation
    if [[ "$confirmation" != "RESTORE" ]]; then
        printf 'Recovery cancelled.\n'
        exit 1
    fi
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
failed_root="$mount_dir/@failed-$timestamp"

btrfs subvolume snapshot "$current_root" "$failed_root"
btrfs subvolume delete "$current_root"
btrfs subvolume snapshot "$snapshot" "$current_root"
sync

printf 'Root restored from snapshot %s.\n' "$snapshot_id"
printf 'The previous root is preserved as %s.\n' "$(basename "$failed_root")"
```

Run:

```bash
chmod +x config/includes.chroot/usr/local/sbin/ru-recover-root
```

- [ ] **Step 4: Run tests and lint**

Run:

```bash
bats tests/restore_root.bats
shellcheck config/includes.chroot/usr/local/sbin/ru-recover-root
```

Expected: 3 tests PASS and ShellCheck reports no findings.

- [ ] **Step 5: Commit recovery tool**

```bash
git add config/includes.chroot/usr/local/sbin/ru-recover-root tests/restore_root.bats
git commit -m "feat: add offline Btrfs root recovery"
```

---

### Task 8: ISO Build and UEFI QEMU Smoke Test

**Files:**
- Create: `scripts/smoke-iso.sh`
- Modify: `tests/repository_layout.bats`

**Interfaces:**
- Consumes: ISO from Task 2 and serial marker from Task 3.
- Produces: automated proof that the ISO boots through UEFI to `graphical.target`.

- [ ] **Step 1: Add failing smoke-script structure test**

Append to `tests/repository_layout.bats`:

```bash
@test "smoke test boots with QEMU and waits for readiness marker" {
    test -x scripts/smoke-iso.sh
    grep -F "qemu-system-x86_64" scripts/smoke-iso.sh
    grep -F "RU_DESKTOP_LIVE_READY" scripts/smoke-iso.sh
    grep -F "OVMF_CODE" scripts/smoke-iso.sh
}
```

- [ ] **Step 2: Run the structure test and verify it fails**

Run:

```bash
bats tests/repository_layout.bats
```

Expected: the new test FAILS because `scripts/smoke-iso.sh` does not exist.

- [ ] **Step 3: Implement the UEFI boot smoke test**

Create executable `scripts/smoke-iso.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

iso="${1:-build/ru-desktop-preview-0.1-amd64.iso}"
timeout_seconds="${RU_SMOKE_TIMEOUT_SECONDS:-300}"
log_file="${RU_SMOKE_LOG:-build/qemu-smoke.log}"

if [[ ! -s "$iso" ]]; then
    printf 'ISO not found or empty: %s\n' "$iso" >&2
    exit 1
fi

ovmf=""
for candidate in \
    /usr/share/OVMF/OVMF_CODE_4M.fd \
    /usr/share/OVMF/OVMF_CODE.fd; do
    if [[ -f "$candidate" ]]; then
        ovmf="$candidate"
        break
    fi
done
if [[ -z "$ovmf" ]]; then
    printf 'OVMF_CODE firmware was not found.\n' >&2
    exit 1
fi

install -d "$(dirname "$log_file")"
: > "$log_file"

qemu-system-x86_64 \
    -machine q35,accel=tcg \
    -m 4096 \
    -smp 2 \
    -bios "$ovmf" \
    -cdrom "$iso" \
    -boot d \
    -display none \
    -serial "file:$log_file" \
    -no-reboot \
    -snapshot &
qemu_pid=$!

cleanup() {
    if kill -0 "$qemu_pid" >/dev/null 2>&1; then
        kill "$qemu_pid"
    fi
    wait "$qemu_pid" 2>/dev/null || true
}
trap cleanup EXIT

deadline=$((SECONDS + timeout_seconds))
while (( SECONDS < deadline )); do
    if grep -Fq "RU_DESKTOP_LIVE_READY" "$log_file"; then
        printf 'UEFI live boot smoke test passed.\n'
        exit 0
    fi
    if ! kill -0 "$qemu_pid" >/dev/null 2>&1; then
        printf 'QEMU exited before the live system became ready.\n' >&2
        exit 1
    fi
    sleep 2
done

printf 'Timed out waiting for RU_DESKTOP_LIVE_READY.\n' >&2
exit 1
```

Run:

```bash
chmod +x scripts/smoke-iso.sh
```

- [ ] **Step 4: Run the structural test, build, and boot the ISO**

Run:

```bash
bats tests/repository_layout.bats
./scripts/builder.sh iso
./scripts/builder.sh smoke
```

Expected:

- repository-layout tests PASS;
- `build/ru-desktop-preview-0.1-amd64.iso` is non-empty;
- the SHA-256 sidecar exists;
- smoke output ends with `UEFI live boot smoke test passed.`

- [ ] **Step 5: Commit smoke automation**

```bash
git add scripts/smoke-iso.sh tests/repository_layout.bats
git commit -m "test: boot preview ISO with UEFI QEMU"
```

---

### Task 9: Real Btrfs Recovery Test and Operator Documentation

**Files:**
- Create: `tests/recovery_loopback.bats`
- Create: `docs/build-and-recovery.md`

**Interfaces:**
- Consumes: `ru-recover-root` from Task 7.
- Produces: root-only loopback integration test proving the snapshot replacement algorithm and operator instructions for build, install, snapshot, and recovery.

- [ ] **Step 1: Write the root-only loopback integration test**

Create `tests/recovery_loopback.bats`:

```bash
#!/usr/bin/env bats

setup() {
    if [[ "$EUID" -ne 0 ]]; then
        skip "loopback Btrfs test requires root in builder container"
    fi
    image="$BATS_TEST_TMPDIR/btrfs.img"
    mount_dir="$BATS_TEST_TMPDIR/mnt"
    truncate -s 512M "$image"
    loop_device="$(losetup --find --show "$image")"
    mkfs.btrfs -q "$loop_device"
    mkdir -p "$mount_dir"
    mount -o subvolid=5 "$loop_device" "$mount_dir"
    btrfs subvolume create "$mount_dir/@"
    btrfs subvolume create "$mount_dir/@snapshots"
    mkdir -p "$mount_dir/@snapshots/17"
    printf 'before\n' > "$mount_dir/@/state"
    btrfs subvolume snapshot -r "$mount_dir/@" "$mount_dir/@snapshots/17/snapshot"
    printf 'after\n' > "$mount_dir/@/state"
    umount "$mount_dir"
}

teardown() {
    if mountpoint -q "$mount_dir"; then
        umount "$mount_dir"
    fi
    if [[ -n "${loop_device:-}" ]]; then
        losetup --detach "$loop_device"
    fi
}

@test "offline recovery replaces root with selected snapshot" {
    run env RU_RECOVERY_MOUNT="$mount_dir" \
        config/includes.chroot/usr/local/sbin/ru-recover-root --yes "$loop_device" 17
    [ "$status" -eq 0 ]

    mount -o subvol=@ "$loop_device" "$mount_dir"
    run cat "$mount_dir/state"
    [ "$status" -eq 0 ]
    [ "$output" = "before" ]
    umount "$mount_dir"

    mount -o subvolid=5 "$loop_device" "$mount_dir"
    run bash -c "compgen -G '$mount_dir/@failed-*'"
    [ "$status" -eq 0 ]
}
```

- [ ] **Step 2: Run the integration test**

Run:

```bash
bats tests/recovery_loopback.bats
```

Expected: 1 test PASS inside the privileged builder container.

- [ ] **Step 3: Add operator documentation**

Create `docs/build-and-recovery.md`:

````markdown
# RU Desktop Preview: build and recovery

## Build prerequisites

Install Docker or Podman on a Linux host. The builder uses a privileged Ubuntu
26.04 container because live-build and the Btrfs integration test need loop and
mount capabilities.

## Verify without building an ISO

```bash
./scripts/builder.sh verify
```

This runs ShellCheck, YAML parsing, Bats unit tests, and the loopback Btrfs
recovery test.

## Build and boot-test the ISO

```bash
./scripts/builder.sh iso
./scripts/builder.sh smoke
```

Artifacts:

- `build/ru-desktop-preview-0.1-amd64.iso`
- `build/ru-desktop-preview-0.1-amd64.iso.sha256`
- `build/qemu-smoke.log`

## Installation safety

The preview supports x86-64 UEFI systems. Test it in a virtual machine before
using physical hardware. Calamares displays its partition summary and final
confirmation before writing changes. Back up user data before resizing an
existing Windows partition.

## Snapshot behavior

The installed Btrfs layout uses:

- `@` for `/`
- `@home` for `/home`
- `@snapshots` for `/.snapshots`
- `@swap` for the swap file

Snapper creates timeline snapshots and one important snapshot before each APT
transaction. The transaction hook does not run on ext4 or XFS installations.

List snapshots from the installed system:

```bash
sudo snapper -c root list
```

## Offline recovery

Boot the RU Desktop live ISO. Identify the Btrfs system partition:

```bash
lsblk --fs
```

For an encrypted installation, unlock the LUKS partition first:

```bash
sudo cryptsetup open /dev/nvme0n1p3 ru-desktop-root
```

Ensure the partition is not mounted, then restore snapshot 17:

```bash
sudo ru-recover-root /dev/nvme0n1p3 17
```

For the encrypted example, pass `/dev/mapper/ru-desktop-root` instead.

Read the summary and type `RESTORE`. The tool preserves the failed root as an
`@failed-<UTC timestamp>` subvolume before replacing `@`. User data in `@home`
is not replaced.
````

- [ ] **Step 4: Run complete verification**

The existing `bats tests` target discovers `recovery_loopback.bats` automatically.

Run:

```bash
./scripts/builder.sh verify
./scripts/builder.sh iso
./scripts/builder.sh smoke
sha256sum --check build/ru-desktop-preview-0.1-amd64.iso.sha256
```

Expected:

- ShellCheck and YAML parsing PASS;
- all Bats tests PASS;
- the UEFI smoke test PASS;
- SHA-256 verification prints `OK`.

- [ ] **Step 5: Commit documentation and integration coverage**

```bash
git add tests/recovery_loopback.bats docs/build-and-recovery.md
git commit -m "test: verify Btrfs recovery end to end"
```

---

## Final Acceptance Checklist

- [ ] `./scripts/builder.sh verify` passes from a clean clone.
- [ ] `./scripts/builder.sh iso` produces the ISO and matching SHA-256 file.
- [ ] `./scripts/builder.sh smoke` boots the ISO through OVMF and observes `RU_DESKTOP_LIVE_READY`.
- [ ] Calamares opens from the live desktop and defaults automatic installation to Btrfs.
- [ ] A manual VM install creates separate `@`, `@home`, `@snapshots`, and `@swap` subvolumes.
- [ ] `snapper -c root list` shows `Initial installation`.
- [ ] A test APT installation creates exactly one important snapshot.
- [ ] Offline recovery restores a chosen root snapshot while preserving `@home` and the failed root.
- [ ] Installation with ext4 remains possible but clearly lacks snapshot and recovery support.
- [ ] No proprietary package, telemetry endpoint, live API key, or private signing key is present in the ISO.

## Manual Review Gate

Before implementing Welcome or any higher-level feature, install this ISO in:

1. a UEFI QEMU VM with a blank disk;
2. a UEFI QEMU VM beside a disposable Windows installation;
3. one Intel laptop and one AMD system.

Record installer logs, Btrfs subvolume output, one successful update snapshot, and one successful offline recovery. Failures in partitioning, bootloader installation, or recovery block the next subsystem plan.
