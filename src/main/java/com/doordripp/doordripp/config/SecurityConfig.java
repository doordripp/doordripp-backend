package com.doordripp.doordripp.config;

import com.doordripp.doordripp.repository.CustomerRepository;
import com.doordripp.doordripp.model.Customer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.core.userdetails.*;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {

    private final CustomerRepository customerRepository;

    public SecurityConfig(CustomerRepository customerRepository) {
        this.customerRepository = customerRepository;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    // simple UserDetailsService backed by CustomerRepository (assumes Customer has email & password fields)
    @Bean
    public UserDetailsService userDetailsService() {
        return username -> {
            Customer c = customerRepository.findByEmail(username)
                    .orElseThrow(() -> new UsernameNotFoundException("User not found: " + username));
            return User.withUsername(c.getEmail())
                    .password(c.getPassword())
                    .roles("USER")
                    .build();
        };
    }

    // basic security filter chain - authenticate by default, keep H2 console accessible in dev if needed
    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable()) // disable for development; enable for production
            .authorizeHttpRequests(auth -> auth
                    .requestMatchers("/h2-console/**").permitAll()
                    .requestMatchers("/", "/demo/**", "/demo/index.html", "/demo/app.js").permitAll()
                    .requestMatchers("/api/**").permitAll()
                    .requestMatchers("/public/**", "/login", "/register").permitAll()
                    .anyRequest().authenticated()
            )
            .formLogin(form -> form
                    .loginPage("/login")
                    .permitAll()
            )
            .logout(logout -> logout.permitAll());

        // allow frames for H2 console
        http.headers(headers -> headers.frameOptions(frame -> frame.sameOrigin()));

        return http.build();
    }
}
