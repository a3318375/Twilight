---
title: 为什么我最终把绿联 NAS 重装成了 Debian 13
published: 2026-07-27
pinned: false
description: 一次绿联 NAS 迁移记录：备份原系统盘、覆盖安装 Debian 13、处理旧数据盘、重建 ext4、迁移 Docker 到 SSD，并把机械盘休眠、唤醒日志、温度和风扇灯控补齐。
cover: ""
coverInContent: false
tags: [绿联 NAS, Debian 13, Docker, ext4, 硬盘休眠]
category: HomeLab
draft: false
---

绿联原系统不是不能用。

如果只是当一台成品 NAS，它其实挺省心：应用商店、相册、远程访问、存储管理，能点的地方都给你做好了。对很多人来说，这就是 NAS 应该有的样子。

但我越用越别扭。

我真正想要的不是一个包装好的 NAS 面板，而是一台普通 Linux 服务器。Docker 想怎么跑就怎么跑，日志写到哪里能说清楚，机械盘为什么被唤醒能查出来，出了问题也能按 Debian 的资料去排。

所以最后我把这台绿联 NAS 重装成了 Debian 13。

安装本身并不复杂。麻烦的是后面这一串东西：旧数据盘不是普通 ext4，绿联的 ext4 带了 Debian 不认识的特性位；Docker 数据目录要重新规划；普通用户权限不能乱给；机械盘也不是格式化完就会自动休眠。

这篇记录的是这次迁移真正踩到的地方。

<!-- more -->

## 为什么要重装

我不是因为原系统坏了才重装的。它没有突然崩，也没有出现一个必须立刻逃离的故障。

真正让我下决心的，是长期使用里的几个小问题。

### 更新节奏跟着厂商走

成品 NAS 系统的稳定性不错，但内核、Docker、命令行工具和系统组件都跟着厂商更新。

如果只是共享文件，这不算大事。可我的 NAS 上会跑不少 Docker 服务，遇到问题时，我更希望底层是一套标准 Debian。至少路径、日志、服务管理、包管理都能按常规 Linux 的方式查。

### 后台组件太多

原系统自带相册、媒体、索引、搜索、云服务、通知和设备管理。

这些东西不是没用，只是我已经有自己的相册、媒体服务、网盘和监控。原系统里很多功能对我来说就成了重复建设。

更烦的是后台扫描和索引。它不一定占很多 CPU，但它可能访问机械盘。机械盘一被访问，就很难安静下来。

### 我想知道硬盘到底在干什么

我关心的不是界面上有没有显示“休眠”，而是更具体的事：

- 盘片现在是不是真的停了；
- 是哪个进程碰了磁盘；
- 一天里被唤醒了几次；
- 数据库、日志、缓存是不是都在 SSD；
- SMART 检查会不会把休眠盘叫醒。

这些在 Debian 里都能查。`hdparm`、`smartctl`、`iotop`、`fuser`、`journalctl`，工具都在那里。

我最后想要的结构也很简单：

```text
系统和高频服务跑在 SSD
Docker、数据库、日志和缓存写到 SSD
机械盘只放媒体和冷数据
需要时唤醒，空闲后休眠
每一次唤醒都能查到记录
```

## 覆盖系统盘前，先备份

这台机器原本有一块系统 SSD。原系统、恢复分区、厂商数据都在上面。

我想过几种方案：再加一块 SSD 装 Debian，用 U 盘跑系统，或者直接覆盖原系统盘。最后还是选了最直接的方式：备份后覆盖系统 SSD。

原因也不复杂。系统 SSD 本来就是用来装系统的，Debian 占用不大，我也不想为了保留原系统再长期占一块盘。

但覆盖之前一定要留退路。

成品 NAS 的系统盘通常不只是一个根分区。它可能还有 EFI、恢复分区、工厂数据、隐藏配置和引导信息。只复制几个分区不放心，所以我直接做整盘镜像。

先确认系统盘：

```bash
lsblk -o NAME,SIZE,MODEL,SERIAL,FSTYPE,MOUNTPOINTS
```

假设系统盘是 `/dev/nvmeXn1`，备份盘挂载在 `/mnt/backup`：

```bash
sudo dd if=/dev/nvmeXn1 bs=64M status=progress | \
  gzip -1 -c > /mnt/backup/ugreen-system-disk.img.gz
sync
```

再保存校验值：

```bash
sha256sum /mnt/backup/ugreen-system-disk.img.gz \
  > /mnt/backup/ugreen-system-disk.img.gz.sha256
sha256sum -c /mnt/backup/ugreen-system-disk.img.gz.sha256
```

这份镜像不是为了日常用，只是为了以后真的后悔时还有办法回去。

恢复时方向反过来：

```bash
gzip -dc /mnt/backup/ugreen-system-disk.img.gz | \
  sudo dd of=/dev/nvmeXn1 bs=64M status=progress conv=fsync
```

`dd` 不会提醒你选错盘。设备名、容量、型号、序列号都要核对清楚。

安装 Debian 时也一样。最稳妥的做法是只保留系统盘；如果不方便拔盘，就在安装器里反复确认目标磁盘，不要把 Debian 装到机械数据盘上。

## 旧数据盘没有直接挂上

Debian 装好后，我第一反应是把旧数据盘挂起来。

我原本以为这一步不会太难。底层还是 Linux，文件系统看起来也是 ext4。就算中间套了 RAID 或 LVM，装上工具以后应该也能识别。

实际不是这样。

旧盘大概是这个结构：

```text
物理磁盘
└── 单盘 mdadm RAID1
    └── LVM
        └── ext4 文件系统
```

这个“单盘 RAID1”看着怪，但确实存在。所以不能直接：

```bash
mount /dev/sdX /mnt/old
```

要先装工具：

```bash
sudo apt install -y mdadm lvm2
```

然后扫描和激活：

```bash
sudo mdadm --assemble --scan
sudo pvscan
sudo vgscan
sudo vgchange -ay
lsblk -f
sudo lvs
sudo vgs
```

到这里，mdadm 和 LVM 都能识别，逻辑卷也能看到。

真正卡住的是最后一步：挂载 ext4。

## 旧 ext4 卡在一个未知特性位上

继续用 `dumpe2fs` 看文件系统：

```bash
sudo dumpe2fs -h /dev/mapper/<旧逻辑卷>
```

核心报错是：

```text
Filesystem has unsupported feature(s)
```

再看超级块，发现 incompat 标记里有一个 Debian 标准 `e2fsprogs` 不认识的位：

```text
0x20000000
```

这就不是普通 ext4 损坏，也不是单纯的 mdadm 或 LVM 问题了。

绿联系统在 ext4 上加了额外特性。Debian 工具看到未知的 incompat 位，会拒绝挂载。这个行为其实是对的。它不知道这个位意味着什么，就不应该假装知道，然后继续读写。

这时候最容易想到的办法，是把标记清掉：

```bash
tune2fs -O ...
debugfs -w ...
e2fsck -y ...
```

我没有这么做。

未知标记背后可能不只是一个无意义开关，也可能对应厂商改过的工具链或磁盘结构。强行清掉之后，文件系统也许表面上能挂载，但后续读写反而可能把数据弄坏。

## 社区恢复工具，以及我为什么没继续

后来我查到一个社区项目：

```text
ugreen-os-ext4-recovery
```

它不是简单地把标记抹掉，而是用打过补丁的 `e2fsprogs` 去识别绿联增加的 `0x20000000` incompat 位，再尝试恢复或挂载。

这个方向比直接改超级块靠谱。但实际操作起来，至少要做几件事：

- 编译定制工具；
- 看懂恢复脚本会改什么；
- 最好先做整盘镜像；
- 在副本上验证，不直接动原盘；
- 接受社区逆向工具可能不完整的风险。

如果盘里是不可替代的数据，我会继续走这条路。

但我的旧盘里主要是可以重新获取的媒体文件。为了这些数据再准备镜像空间、编译工具、验证补丁，投入已经超过了数据本身的价值。

最后只能接受现实：旧结构不恢复了，清空重建。

## 清掉旧结构，重建标准 ext4

放弃旧数据后，要把旧盘上的 mdadm、LVM、文件系统签名和分区表都清掉。

操作前再次确认磁盘：

```bash
lsblk -o NAME,SIZE,MODEL,SERIAL,FSTYPE,MOUNTPOINTS
```

停止旧阵列和 LVM 后：

```bash
sudo wipefs -a /dev/sdX
sudo mdadm --zero-superblock /dev/sdX
```

再重新建立 GPT：

```bash
sudo parted /dev/sdX --script mklabel gpt
sudo parted /dev/sdX --script mkpart primary 0% 100%
```

NVMe 也是同样思路，只是设备名通常类似 `/dev/nvmeXn1`。

最后每块数据盘都变成：

```text
GPT
└── 单一 ext4 分区
```

不再套 mdadm，也不再套 LVM。

对我这种不需要 RAID 的个人 NAS 来说，这样更直观。哪块盘出问题，直接看那块盘；换系统、迁移数据、排查故障，也少一层东西要猜。

## 机械盘和 SSD 的格式化参数

机械盘和 SSD 都可以用 ext4，但用途不一样。

机械盘主要放电影、剧集、镜像、备份包这类大文件，我用了：

```bash
sudo mkfs.ext4 \
  -T largefile4 \
  -m 0 \
  -L data-hdd \
  /dev/sdX1
```

`-T largefile4` 主要是减少 inode 数量，不会让大文件读写突然变快。如果盘里有大量小文件，就不适合这么格式化。

SSD 用来放 Docker、数据库、应用配置和缓存，文件大小更杂，直接普通 ext4：

```bash
sudo mkfs.ext4 \
  -m 0 \
  -L data-ssd \
  /dev/nvmeXn1p1
```

我没有关闭 lazy inode 初始化。

ext4 默认会启用 lazy inode table initialization。格式化会很快完成，但第一次挂载后，内核还会在后台慢慢初始化 inode 表。后面机械盘长时间不休眠，原因之一就是它。

这不是异常写入，也不是硬盘故障。它只是一次性后台任务。

## 用 UUID 挂载

不要长期依赖 `/dev/sda1`、`/dev/sdb1`。设备名可能因为启动顺序变化而交换。

查看 UUID：

```bash
lsblk -f
sudo blkid
```

创建挂载点：

```bash
sudo mkdir -p /mnt/hdd1 /mnt/hdd2 /mnt/ssd
```

`/etc/fstab` 示例：

```text
UUID=<机械盘1-UUID> /mnt/hdd1 ext4 defaults,noatime,nofail 0 2
UUID=<机械盘2-UUID> /mnt/hdd2 ext4 defaults,noatime,nofail 0 2
UUID=<SSD-UUID>     /mnt/ssd  ext4 defaults,noatime,nofail 0 2
```

检查：

```bash
sudo systemctl daemon-reload
sudo mount -a
findmnt --verify
lsblk -o NAME,SIZE,FSTYPE,LABEL,UUID,MOUNTPOINTS
```

`noatime` 可以减少读取文件时的无意义写入。`nofail` 可以避免某块数据盘异常时让整个系统卡在启动阶段。

不过，如果 Docker 数据放在 SSD 上，还要给 Docker 加挂载依赖。否则 SSD 没挂上时，Docker 可能直接写进系统盘里的 `/mnt/ssd` 空目录。

## SSD 的 TRIM

Debian 自带 `fstrim.timer`。我没有在 `/etc/fstab` 里长期使用在线 `discard`。

启用：

```bash
sudo systemctl enable --now fstrim.timer
```

查看：

```bash
systemctl status fstrim.timer --no-pager
systemctl list-timers fstrim.timer
```

手动测试：

```bash
sudo fstrim -v /mnt/ssd
```

新格式化的空 SSD 第一次执行时，显示接近整盘容量被 trim，是正常现象。

## Docker 数据放到 SSD

Docker 程序本身还是通过 APT 安装在系统盘：

```text
/usr/bin/docker
/usr/bin/dockerd
/etc/docker
systemd 服务
```

真正要搬到 SSD 的，是镜像、容器可写层、containerd 快照、volume、构建缓存和容器日志。

假设 SSD 挂载在 `/mnt/ssd`：

```bash
sudo mkdir -p /mnt/ssd/docker/engine
sudo mkdir -p /mnt/ssd/docker/containerd
```

Docker 配置：

```bash
sudo mkdir -p /etc/docker

sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "data-root": "/mnt/ssd/docker/engine",
  "log-driver": "local",
  "log-opts": {
    "max-size": "20m",
    "max-file": "3"
  }
}
EOF

python3 -m json.tool /etc/docker/daemon.json
```

containerd 配置：

```bash
sudo mkdir -p /etc/containerd

sudo tee /etc/containerd/config.toml >/dev/null <<'EOF'
version = 2

root = "/mnt/ssd/docker/containerd"
state = "/run/containerd"
EOF
```

再加挂载依赖，防止 SSD 没挂上时 Docker 写系统盘：

```bash
sudo mkdir -p /etc/systemd/system/docker.service.d

sudo tee /etc/systemd/system/docker.service.d/storage.conf >/dev/null <<'EOF'
[Unit]
RequiresMountsFor=/mnt/ssd
EOF

sudo mkdir -p /etc/systemd/system/containerd.service.d

sudo tee /etc/systemd/system/containerd.service.d/storage.conf >/dev/null <<'EOF'
[Unit]
RequiresMountsFor=/mnt/ssd
EOF

sudo systemctl daemon-reload
```

安装 Docker 官方版本：

```bash
sudo apt update
sudo apt install -y ca-certificates curl

sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin
```

验证：

```bash
systemctl is-active docker
systemctl is-active containerd
sudo docker info --format 'Docker Root Dir: {{.DockerRootDir}}'
sudo containerd config dump | grep -E '^(version|root|state)'
sudo docker run --rm hello-world
```

## Docker 内部目录不要随便 chown

为了方便，很容易想直接：

```bash
sudo chown -R <用户>:<用户> /mnt/ssd/docker
```

我不建议这么做。

Docker 的 engine 和 containerd 目录里有内部数据、快照和元信息，应该继续由 root 管理。普通用户只需要管理 Compose 文件。

我最后用的是这种结构：

```text
/mnt/ssd/docker
├── engine          root 管理
├── containerd      root 管理
└── file            普通用户管理
    └── stacks
```

创建 Compose 目录：

```bash
sudo mkdir -p /mnt/ssd/docker/file/stacks
sudo chown -R <用户>:<用户> /mnt/ssd/docker/file
sudo chmod 755 /mnt/ssd/docker
```

以后 Compose 文件放在 `/mnt/ssd/docker/file/stacks`，不要进 `engine`、`containerd` 里手动改。

## 机械盘为什么一直不休眠

硬盘状态可以用：

```bash
sudo hdparm -C /dev/sdX
```

`active/idle` 表示盘片还在转，`standby` 才是待机。

新格式化后，我发现两块机械盘一整夜都没有休眠，写入计数还在慢慢增加。

查看写入计数：

```bash
awk '{print $7}' /sys/block/sdX/stat
```

隔一分钟再看，数字仍然在涨。

继续查：

```bash
ps -e -o pid,comm,wchan:40 | grep -E 'ext4lazyinit|jbd2/sd'
sudo apt install -y psmisc
sudo fuser -vm /mnt/hdd1
```

没有发现 Jellyfin、Docker、数据库这类用户进程，只有内核挂载。

最后确认原因是：

```text
ext4lazyinit
```

也就是 ext4 的延迟 inode 表初始化。

它是新格式化 ext4 后的一次性后台任务，写入速度很低，主要代价只是让硬盘多转几个小时。

这时候不要反复强制休眠：

```bash
sudo hdparm -y /dev/sdX
```

后台任务很快又会把盘叫醒，启停次数反而增加。

检查是否结束：

```bash
ps -C ext4lazyinit -o pid,etime,comm
```

只有表头、没有进程，就说明初始化已经完成。

## 设置机械盘自动休眠

确认没有持续写入后，我设置空闲 30 分钟休眠：

```bash
sudo hdparm -S 241 /dev/sdX
```

`241` 表示 30 分钟。

半小时后查看：

```bash
sudo hdparm -C /dev/sdX
```

如果显示：

```text
standby
```

就说明成功了。

`hdparm -S` 重启后可能丢失，所以可以做成 systemd 服务。长期使用最好写 `/dev/disk/by-id/`，不要依赖 `/dev/sda`。

```bash
sudo tee /etc/systemd/system/hdd-spindown.service >/dev/null <<'EOF'
[Unit]
Description=Set HDD spindown timeout
After=local-fs.target

[Service]
Type=oneshot
ExecStart=/usr/sbin/hdparm -S 241 /dev/disk/by-id/<机械盘1>
ExecStart=/usr/sbin/hdparm -S 241 /dev/disk/by-id/<机械盘2>
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now hdd-spindown.service
sudo systemctl status hdd-spindown.service --no-pager
```

注意，设置 `-S` 时某些硬盘会被唤醒，所以这个服务开机执行一次就够了，不要平时反复重启。

## 记录硬盘什么时候被唤醒

Linux 默认不会记录机械盘从 `standby` 变成 `active/idle` 的历史。

我做了一个简单脚本：每分钟读一次状态，只在状态变化时写入 journald。日志写在系统盘，不会写机械数据盘。

```bash
sudo tee /usr/local/sbin/hdd-power-watch >/dev/null <<'EOF'
#!/bin/bash

STATE_DIR=/run/hdd-power-watch
mkdir -p "$STATE_DIR"

for MOUNT_POINT in /mnt/hdd1 /mnt/hdd2; do
    PARTITION=$(findmnt -n -o SOURCE "$MOUNT_POINT" 2>/dev/null)
    [ -n "$PARTITION" ] || continue

    DISK="/dev/$(lsblk -ndo PKNAME "$PARTITION")"
    [ -b "$DISK" ] || continue

    STATE=$(
        /usr/sbin/hdparm -C "$DISK" 2>/dev/null |
        sed -n 's/.*drive state is:[[:space:]]*//p'
    )

    [ -n "$STATE" ] || STATE=unknown

    NAME=$(basename "$MOUNT_POINT")
    STATE_FILE="$STATE_DIR/$NAME"
    OLD_STATE=$(cat "$STATE_FILE" 2>/dev/null || echo unknown)

    if [ "$STATE" != "$OLD_STATE" ]; then
        logger -t hdd-power "$MOUNT_POINT ($DISK): $OLD_STATE -> $STATE"
        printf '%s\n' "$STATE" > "$STATE_FILE"
    fi
done
EOF

sudo chmod 755 /usr/local/sbin/hdd-power-watch
```

service：

```bash
sudo tee /etc/systemd/system/hdd-power-watch.service >/dev/null <<'EOF'
[Unit]
Description=Record HDD power state changes
After=local-fs.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/hdd-power-watch
EOF
```

timer：

```bash
sudo tee /etc/systemd/system/hdd-power-watch.timer >/dev/null <<'EOF'
[Unit]
Description=Check HDD power states every minute

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=10s

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now hdd-power-watch.timer
sudo systemctl start hdd-power-watch.service
```

查看日志：

```bash
sudo journalctl -t hdd-power --no-pager
```

日志里大概会看到这些状态变化：

```text
unknown -> active/idle      第一次建立基准状态
active/idle -> standby      硬盘进入休眠
standby -> active/idle      硬盘被唤醒
```

统计当天唤醒次数：

```bash
sudo journalctl -t hdd-power --since today --no-pager |
grep -c 'standby -> active/idle'
```

## 温度、SMART、风扇和前面板灯

安装工具：

```bash
sudo apt install -y smartmontools lm-sensors
```

CPU、NVMe、内存和网卡温度：

```bash
sensors
```

机械盘温度：

```bash
sudo smartctl -A /dev/sdX
```

但普通 SMART 查询可能会唤醒休眠盘。休眠后用：

```bash
sudo smartctl -A -n standby /dev/sdX
```

如果磁盘正在休眠，它会直接退出，不会强行唤醒。

风扇方面，DXP4800 Plus 使用 IT8613E 监控芯片。安装社区 it87 驱动后，可以看到类似 `fan2`、`fan3`、`pwm2`、`pwm3`。

社区驱动：

```text
https://github.com/IT-Kuny/UGREEN-DXP-FAN-NAS-Driver
```

我的处理方式是先观察转速，不急着用 `pwmconfig` 接管风扇。只要 CPU、SSD 和网卡温度正常，让主板自动控制通常更稳。

前面板灯可以用 LLLED：

```text
https://github.com/BearHero520/LLLED
```

当时我遇到一个入口软链接路径问题：主程序通过 `/usr/local/bin/LLLED` 启动时，会把依赖目录算成 `/usr/local/bin/scripts`。

最后用包装脚本直接调用真实入口：

```bash
sudo rm -f /usr/local/bin/LLLED

sudo tee /usr/local/bin/LLLED >/dev/null <<'EOF'
#!/bin/bash
exec /opt/ugreen-led-controller/ugreen_led_controller.sh "$@"
EOF

sudo chmod 755 /usr/local/bin/LLLED
sudo LLLED status
```

## 最后的结构

迁移完以后，这台 NAS 的逻辑就清楚多了：

```text
系统 SSD
├── Debian
├── Docker 程序
├── systemd
└── 系统日志

应用 SSD
├── Docker engine
├── containerd
├── 数据库
├── 应用配置
├── 缩略图
└── 缓存

机械数据盘
├── 媒体
├── 归档
└── 低频数据
```

机械盘不再承担 Docker 容器层、数据库、系统日志、缓存、缩略图和构建缓存。

它只放冷数据。这样它才更容易保持安静。

## 这次迁移后的几个判断

Debian 不会天然比原 NAS 系统更伤盘。

硬盘并不知道上层跑的是绿联系统、Debian 还是 TrueNAS。真正影响机械盘的是温度、震动、电源质量、通电时间、读写负载、启停次数和后台访问频率。

频繁休眠也不一定比一直转更好。比较糟糕的是这种循环：

```text
休眠
几分钟后被唤醒
再次休眠
又被后台扫描唤醒
```

所以休眠时间不要设得太短，还要记录实际唤醒次数。

旧盘恢复也要看数据价值。社区恢复工具值得尊重，也可能真的能救回数据。但恢复需要时间、额外磁盘、镜像空间和风险控制。数据越重要，越应该先做完整副本再研究；数据可以重新获取时，清空重建反而更理性。

最后，重装 Debian 的意义不是再堆一个 NAS 面板出来，而是只运行自己真正需要的服务。服务越少，后台行为越容易理解，机械盘也越容易安静。

这次最花时间的不是 Debian 安装器，也不是 Docker，而是弄清楚原系统对磁盘做了什么，以及迁移后怎样建立一套自己能看懂、能维护的存储逻辑。

我最后得到的不是一个功能更多的 NAS 系统，而是一台行为更可预测的 Linux 服务器：系统怎么更新，服务怎么跑，数据写到哪里，机械盘什么时候休眠，硬盘什么时候被唤醒，都能查清楚。

这就是我最终放弃原系统、选择 Debian 的原因。
