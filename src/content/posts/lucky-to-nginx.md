---
title: 从 Lucky 迁移到 Nginx：我的轻量级反向代理方案
published: 2026-05-19
pinned: false
description: 从 Lucky 切到 nginx-ui + Nginx 的过程记录，包含部署方式、DDNS 配置、腾讯云子账号权限和防火墙放行。
cover: "https://media.yuxh.cc/blog/20260121145645.png"
coverInContent: true
tags: [Nginx, 反向代理, DDNS, 运维]
category: 笔记
draft: false
---

Lucky 确实很方便。证书自动续订、DDNS、Web 服务代理这些东西，基本都能开箱即用，点几下就能跑起来。

但我最后还是换回了 Nginx。

原因也很简单，不是 Lucky 不好用，也不是它功能不够，而是它闭源。对我来说，这种承担家庭服务入口的东西，如果太黑盒，心里总归不太舒服。哪怕它现在用着没问题，我还是更愿意把入口放在一个透明一点、可控一点的方案上。

起初我试过 **Nginx Proxy Manager（NPM）**，但它配置起来总觉得有点绕，尤其是服务和端口一多，就不太顺手。后来换成了 **[nginx-ui](https://github.com/uozi/nginx-ui)**，感觉更适合我一点。界面够简洁，底层又还是 Nginx 这套东西，出了问题也比较好查。

## 部署 nginx-ui

我是用 Docker Compose 部署的，配置如下：

```yaml
services:
  npm:
    image: uozi/nginx-ui:latest
    restart: unless-stopped
    container_name: nginxui
    network_mode: host
    environment:
      TZ: Asia/Shanghai
    ports:
      - 7080:80
      - 7443:443
    volumes:
      - /opt/dockerfile/nginxui/conf:/etc/nginx
      - /opt/dockerfile/nginxui/nginx-ui:/etc/nginx-ui
      - /var/run/docker.sock:/var/run/docker.sock
```

这里有个容易踩的点。

如果你用了 `network_mode: host`，那 `ports` 这两行其实不会生效，所以不能靠 `7080:80` 这种映射去改访问端口。

我这里的做法是直接挂载 `/opt/dockerfile/nginxui/conf`，然后去改里面的监听配置。虽然麻烦一点，但逻辑是直的，后面排查也不会绕晕。

## 防火墙配置

之前用 Lucky 的时候，服务基本能直接访问，很容易让人忽略掉防火墙这件事。

但自己部署 nginx-ui 之后，这一步就得自己补上了。该放行的端口还是得手动放行，不然服务明明跑起来了，外面就是进不去。

去路由器或者系统里的 **防火墙 → 通信规则**，把需要的端口放开，比如 7080、7443，或者你后面实际改成的 HTTPS 端口。

![image](https://media.yuxh.cc/blog/20260121145645.png!inyaa)

## 配置 DDNS（以腾讯云 DNSPod 为例）

如果你用的是内网穿透加 DDNS 这套方案，有个细节最好别漏。

检测本机 IP 的那个 URL，记得加进代理软件的**直连列表**里。不然请求可能会先绕进代理，最后拿到错误的出口 IP。

这个问题不大，但很烦。因为它看起来像是 DDNS 偶尔抽风，实际上是请求路径跑偏了。

![image](https://media.yuxh.cc/blog/20260121145803.png!inyaa)

### 腾讯云子账号权限配置

我用的子账号，只给了一套最小权限的策略。在 **腾讯云控制台 → 访问管理 → 策略** 里新建一个：

```json
{
    "statement": [
        {
            "action": [
                "dnspod:DescribeDomainList",
                "dnspod:DescribeRecordFilterList",
                "dnspod:DescribeRecordList",
                "dnspod:CreateRecord",
                "dnspod:ModifyRecord",
                "dnspod:DeleteRecord"
            ],
            "effect": "allow",
            "resource": [
                "*"
            ]
        }
    ],
    "version": "2.0"
}
```

然后把子账号的 `SecretId` 和 `SecretKey` 填到 nginx-ui 的**凭证管理**里：

![image](https://media.yuxh.cc/blog/20260121145919.png!inyaa)

配域名的时候就能直接选到它了：

![image](https://media.yuxh.cc/blog/20260121150222.png!inyaa)

## 反向代理配置这件事，还是 Nginx 更让我安心

用了 nginx-ui 之后，我最大的感受不是它有多强，而是它更让我安心。

每一个监听端口、域名和转发规则都能拆开看，证书挂在哪、请求转到哪，也都更直观。对我来说，这种透明感比少点几下鼠标更重要。

我这边比较常见的场景，大概就是这些：

- 443 转发到内网 HTTPS 服务
- 不同二级域名分别反代到不同本地端口
- 使用 Let's Encrypt 自动签发证书
- 配合 DDNS 实现公网访问家庭服务

这些事 Lucky 也不是不能做。

只是我最后还是更愿意把入口放在 Nginx 这套开源、标准、可控的方案里。说到底，这次迁移不是为了追求更复杂的配置，而只是因为我自己不喜欢闭源的东西。
