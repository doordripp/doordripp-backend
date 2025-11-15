package com.doordripp.doordripp.controller;

import com.doordripp.doordripp.model.Customer;
import com.doordripp.doordripp.repository.CustomerRepository;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;

@Controller
public class AuthController {
    private final CustomerRepository customerRepository;
    private final PasswordEncoder passwordEncoder;

    public AuthController(CustomerRepository customerRepository, PasswordEncoder passwordEncoder) {
        this.customerRepository = customerRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @GetMapping("/login")
    public String login() {
        return "auth/login";
    }

    @GetMapping("/register")
    public String registerForm(Model model) {
        model.addAttribute("customer", new Customer());
        return "auth/register";
    }

    @PostMapping("/register")
    public String registerSubmit(@ModelAttribute Customer customer, Model model) {
        if (customerRepository.findByEmail(customer.getEmail()).isPresent()) {
            model.addAttribute("error", "Email already registered");
            return "auth/register";
        }

        customer.setPassword(passwordEncoder.encode(customer.getPassword()));
        customerRepository.save(customer);
        return "redirect:/login";
    }
}
