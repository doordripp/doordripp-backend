package com.doordripp.doordripp.controller;

import com.doordripp.doordripp.model.Product;
import com.doordripp.doordripp.repository.CustomerRepository;
import com.doordripp.doordripp.repository.OrderRepository;
import com.doordripp.doordripp.service.ProductService;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;

@Controller
@RequestMapping("/admin")
public class AdminController {
    private final ProductService productService;
    private final OrderRepository orderRepository;
    private final CustomerRepository customerRepository;

    public AdminController(ProductService productService, OrderRepository orderRepository, CustomerRepository customerRepository) {
        this.productService = productService;
        this.orderRepository = orderRepository;
        this.customerRepository = customerRepository;
    }

    @GetMapping
    public String index() {
        return "admin/index";
    }

    @GetMapping("/products")
    public String products(Model model) {
        model.addAttribute("products", productService.findAll());
        return "admin/products";
    }

    @GetMapping("/products/new")
    public String newProduct(Model model) {
        model.addAttribute("product", new Product());
        return "admin/product-form";
    }

    @GetMapping("/products/edit/{id}")
    public String editProduct(@PathVariable Long id, Model model) {
        model.addAttribute("product", productService.findById(id));
        return "admin/product-form";
    }

    @PostMapping("/products/save")
    public String saveProduct(@ModelAttribute Product product) {
        productService.save(product);
        return "redirect:/admin/products";
    }

    @GetMapping("/orders")
    public String orders(Model model) {
        model.addAttribute("orders", orderRepository.findAll());
        return "admin/orders";
    }

    @GetMapping("/customers")
    public String customers(Model model) {
        model.addAttribute("customers", customerRepository.findAll());
        return "admin/customers";
    }
}
