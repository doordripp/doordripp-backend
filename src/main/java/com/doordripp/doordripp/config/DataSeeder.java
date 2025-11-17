package com.doordripp.doordripp.config;

import com.doordripp.doordripp.model.Customer;
import com.doordripp.doordripp.model.Product;
import com.doordripp.doordripp.repository.CustomerRepository;
import com.doordripp.doordripp.repository.ProductRepository;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;

@Component
public class DataSeeder implements ApplicationRunner {
    private final CustomerRepository customerRepository;
    private final ProductRepository productRepository;
    private final PasswordEncoder passwordEncoder;

    public DataSeeder(CustomerRepository customerRepository, ProductRepository productRepository, PasswordEncoder passwordEncoder) {
        this.customerRepository = customerRepository;
        this.productRepository = productRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    public void run(ApplicationArguments args) throws Exception {
        // Ensure demo customer exists
        customerRepository.findByEmail("demo@doordripp.local").orElseGet(() -> {
            Customer c = new Customer();
            c.setName("Demo Customer");
            c.setEmail("demo@doordripp.local");
            c.setPassword(passwordEncoder.encode("demopass"));
            return customerRepository.save(c);
        });

        // Ensure there are products (only add if repository empty)
        if (productRepository.count() == 0) {
            Product p1 = new Product();
            p1.setName("Demo T-Shirt");
            p1.setPrice(new BigDecimal("19.99"));
            p1.setStock(100);
            productRepository.save(p1);

            Product p2 = new Product();
            p2.setName("Demo Mug");
            p2.setPrice(new BigDecimal("9.99"));
            p2.setStock(250);
            productRepository.save(p2);
        }
    }
}
