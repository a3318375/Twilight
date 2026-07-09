---
title: 一种不错的学习型个人开发者的持续集成方案：GitHub Action
published: 2026-05-19
pinned: false
description: 面向个人开发者的轻量级 CI/CD 方案，使用 GitHub Action 实现 Java 项目从代码提交到 Docker 部署的自动化流程。
cover: "https://media.yuxh.cc/blog/20260121111127.png"
coverInContent: true
tags: [CI/CD, GitHub, Docker]
category: 笔记
draft: false
---

我在传统行业上班，公司的部署流程偏老旧，加上我这台 PC 性能也一般，所以最近一直在折腾自动部署。

GitHub Action 和之前写过的 Drone 挺像的：开发者写一个 yml 配置文件，服务读取后从上到下依次执行。

## GitHub 设置

![](https://media.yuxh.cc/article/be70042ac76e4466ac688dce424dc19e.png)

点击 new 之后：

![](https://media.yuxh.cc/article/6274351e911a40ca82131757f21ecdcf.png)

图中都是预设，比如 Docker 的、Java 的，我们先随便点一个。

![](https://media.yuxh.cc/article/1a3681fe35e847de93f1ba5bfd99c40d.png)

左边区域是编写的区域，右边是插件仓库，插件仓库提供了各种别人写好的插件，比如：FTP、SFTP、SSH、Docker。

## YML 示例

```yml
name: java CI

on:
  push:
    branches: [ main ]
    paths-ignore:
      - 'README.md'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Set up JDK 17
        uses: actions/setup-java@v2
        with:
          java-version: '17'
          distribution: 'adopt'
      - name: Validate Gradle wrapper
        uses: gradle/wrapper-validation-action@v1.0.4
      - name: Make Gradlew Executable
        run: chmod +x ./gradlew
      - name: Build with Gradle
        uses: gradle/gradle-build-action@v2.1.4
        with:
          arguments: build
      - uses: mr-smithers-excellent/docker-build-push@v5
        name: Build & push Docker image
        with:
          image: inyaa/inyaa-admin
          tags: latest
          registry: ccr.ccs.tencentyun.com
          dockerfile: Dockerfile
          username: ${{ secrets.DOCKER_HUB_USERNAME }}
          password: ${{ secrets.DOCKER_HUB_PASSWORD }}
      - name: executing remote ssh commands using password
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.HOST }}
          username: ${{ secrets.USERNAME }}
          password: ${{ secrets.PASSWORD }}
          port: ${{ secrets.PORT }}
          script: |
            docker stop $(docker ps -a | grep "inyaa-admin" | awk '{print $1}')
            docker rm -f $(docker ps -a | grep inyaa-admin | awk '{print $1}')
            docker rmi $(docker images | grep inyaa-admin | awk '{print $3}')
            docker run -d -p 8080:8080 --name inyaa-admin --network inyaa --network-alias inyaa-admin --volume=/data/nginx/html/sitemap:/home/sitemap ccr.ccs.tencentyun.com/inyaa/inyaa-admin:latest
```

## 配置逐行看

`branches: [ main ]` — 提交到 main 分支才会触发。`paths-ignore` 用来跳过不相关的文件变更，只改 README 就不会跑。

挨个说一下：

`actions/checkout` — 检出代码

`actions/setup-java@v2` — 配 JDK 17，OpenJDK 用的 adopt 发行版

`gradle/wrapper-validation-action` + `gradle/gradle-build-action` — Gradle 打包流程，先校验 wrapper 再跑 build

`mr-smithers-excellent/docker-build-push` — 用 Dockerfile 打镜像，推到镜像仓库

`appleboy/ssh-action` — SSH 登录服务器执行部署脚本

## 追加说明

服务器地址、密码这些敏感信息，都用 `${{ secrets.xxx }}` 从 GitHub Secrets 里读取，在仓库 Settings 里设置：

![](https://media.yuxh.cc/article/49608cd362984fc0bd08fd77d10656ed.png)
