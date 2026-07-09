---
title: Spring Security 自定义后台权限过滤的方案
published: 2026-05-19
pinned: false
description: 基于 Spring Security 实现自定义后台权限过滤的方案，使用 AuthorizationManager 和 FilterInvocationSecurityMetadataSource 进行动态 URL 权限匹配。
cover: "https://media.yuxh.cc/blog/20260124020439.png"
coverInContent: true
tags: [Java, Spring Security, 权限]
category: 笔记
draft: false
---

## 大概思路

方案有好几种，比如注解式的 `@PreAuthorize("hasRole('ROLE_admin') and hasAnyRole('ROLE_user')")`，或者在配置里写 `hasRole`。

## 我的其中一种思路

```java
@Service
@RequiredArgsConstructor
public class InyaaAccessDecisionManager implements AuthorizationManager<RequestAuthorizationContext> {

    private final SecurityMetadataSource securityMetadataSource;

    @Override
    public AuthorizationDecision check(Supplier<Authentication> authentication, RequestAuthorizationContext context) {
        Collection<ConfigAttribute> collection = this.securityMetadataSource.getAttributes(context);
        // 遍历角色
        for (ConfigAttribute ca : collection) {
            // ① 当前url请求需要的权限
            String needRole = ca.getAttribute();
            if ("ROLE_ANY".equals(needRole)) {
                return new AuthorizationDecision(true);
            } else {
                // ② 当前用户所具有的角色
                Collection<? extends GrantedAuthority> authorities = authentication.get().getAuthorities();
                for (GrantedAuthority authority : authorities) {
                    if ("ROLE_ANONYMOUS".equals(authority.getAuthority())) {
                        return new AuthorizationDecision(false);
                    } else {
                        return new AuthorizationDecision(true);
                    }
                }
            }
        }
        return new AuthorizationDecision(false);
    }
}
```

```java
@Service
@RequiredArgsConstructor
public class InyaaFilterInvocationSecurityMetadataSource implements FilterInvocationSecurityMetadataSource {

    private final CacheService cacheService;

    /***
     * 返回该url所需要的用户权限信息
     *
     * @param object: 储存请求url信息
     * @return: null：标识不需要任何权限都可以访问
     */
    @Override
    public Collection<ConfigAttribute> getAttributes(Object object) throws IllegalArgumentException {
        HttpServletRequest request = ((RequestAuthorizationContext) object).getRequest();
        Map<String, Collection<ConfigAttribute>> cacheMap = cacheService.getConfigAttributeMap();
        for (String url : cacheMap.keySet()) {
            if (new AntPathRequestMatcher(url).matches(request)) {
                return cacheMap.get(url);
            }
        }
        throw new AccessDeniedException("当前访问没有权限！");
    }

    @Override
    public Collection<ConfigAttribute> getAllConfigAttributes() {
        return null;
    }

    @Override
    public boolean supports(Class<?> aClass) {
        return FilterInvocation.class.isAssignableFrom(aClass);
    }
}
```

`AuthorizationManager<RequestAuthorizationContext>` 主要是对角色的验证，他加载 `FilterInvocationSecurityMetadataSource` 接口的数据。而 `FilterInvocationSecurityMetadataSource` 接口主要是做权限的匹配，其中我用到了缓存来加载所有的权限，然后通过 URL 去匹配。

而缓存内的加载大致如下：

```java
public Map<String, Collection<ConfigAttribute>> getConfigAttributeMap() {
    if (AuthCache.size() < 1) {
        List<InyawSysApi> list = inyawSysApiDao.findAll();
        for (InyawSysApi api : list) {
            List<ConfigAttribute> configAttributeList = new ArrayList<>();
            ConfigAttribute configAttribute;
            switch (api.getType()) {
                case 0 -> configAttribute = new SecurityConfig("ROLE_ANY");
                case 1 -> configAttribute = new SecurityConfig("ROLE_LOGIN");
                case 2 -> {
                    InyawSysRole role = inyawSysRoleService.getById(api.getId());
                    configAttribute = new SecurityConfig(role.getRoleKey());
                }
                default -> throw new IllegalStateException("错误的类型: " + api.getType());
            }
            configAttributeList.add(configAttribute);
            AuthCache.put(api.getUrl(), configAttributeList);
        }
    }
    return AuthCache;
}
```

其余就不多解释了，代码水平也一般。大概就是 API 表的 type 字段决定权限类型——当时没想好具体的权限表设计，实际也没这个需求。

## 最后是配置类

```java
http
    .authorizeHttpRequests((authorize) -> authorize
        .anyRequest().access(inyaaAccessDecisionManager)
    )
    .csrf(AbstractHttpConfigurer::disable)
    .oauth2ResourceServer(httpSecurityOAuth2ResourceServerConfigurer ->
        httpSecurityOAuth2ResourceServerConfigurer.jwt(Customizer.withDefaults()))
    .sessionManagement((session) ->
        session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
    .exceptionHandling((exceptions) -> exceptions
        .authenticationEntryPoint(new BearerTokenAuthenticationEntryPoint())
        .accessDeniedHandler(new BearerTokenAccessDeniedHandler())
    );
```

这个配置类基本是官方 Demo 的 JWT 方案，真正管权限的也就 csrf 前面那几行。
