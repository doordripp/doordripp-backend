package com.doordripp.doordripp.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import com.doordripp.doordripp.repository.CustomerRepository;
import com.doordripp.doordripp.model.Customer;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public UserDetailsService userDetailsService(CustomerRepository customerRepository, PasswordEncoder passwordEncoder) {
        return username -> {
            // admin user (in-memory) - simple for demo
            if ("admin".equals(username)) {
                UserDetails admin = User.builder()
                        .username("admin")
                        .password(passwordEncoder.encode("adminpass"))
                        .roles("ADMIN")
                        .build();
                return admin;
            }

            // customers are identified by email
            return customerRepository.findByEmail(username)
                    .map((Customer c) -> User.withUsername(c.getEmail())
                            .password(c.getPassword())
                            .roles("CUSTOMER")
                            .build())
                    .orElseThrow(() -> new UsernameNotFoundException("User not found: " + username));
        };
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.authorizeHttpRequests(auth -> auth
                        .requestMatchers("/admin/**", "/h2-console/**").hasRole("ADMIN")
                        .requestMatchers("/login", "/register", "/css/**", "/js/**").permitAll()
                        .anyRequest().permitAll()
                )
                .formLogin(form -> form.loginPage("/login").defaultSuccessUrl("/", true))
                .logout(logout -> logout.logoutUrl("/logout").logoutSuccessUrl("/"))
                .csrf(csrf -> csrf.disable())
                .headers(headers -> headers.frameOptions(frame -> frame.disable()));

        return http.build();
    }
}
