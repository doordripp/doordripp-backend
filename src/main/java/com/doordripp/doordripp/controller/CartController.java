package com.doordripp.doordripp.controller;

import com.doordripp.doordripp.model.Cart;
import com.doordripp.doordripp.model.Customer;
import com.doordripp.doordripp.model.PurchaseOrder;
import com.doordripp.doordripp.repository.CustomerRepository;
import com.doordripp.doordripp.service.CartService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.NoSuchElementException;

@RestController
@RequestMapping("/api/cart")
public class CartController {
    private final CartService cartService;
    private final CustomerRepository customerRepository;

    public CartController(CartService cartService, CustomerRepository customerRepository) {
        this.cartService = cartService;
        this.customerRepository = customerRepository;
    }

    private Long resolveCustomerId(Long customerId) {
        if (customerId != null) return customerId;
        // fallback: use first customer (demo seed)
        return customerRepository.findAll().stream().findFirst()
                .map(Customer::getId)
                .orElseThrow(() -> new NoSuchElementException("No customers available"));
    }

    @GetMapping
    public ResponseEntity<Cart> getCart(@RequestParam(required = false) Long customerId) {
        Long cid = resolveCustomerId(customerId);
        return ResponseEntity.ok(cartService.getCartForCustomer(cid));
    }

    @PostMapping("/add")
    public ResponseEntity<Cart> addItem(@RequestParam(required = false) Long customerId, @RequestParam Long productId, @RequestParam int quantity) {
        Long cid = resolveCustomerId(customerId);
        return ResponseEntity.ok(cartService.addItem(cid, productId, quantity));
    }

    @PostMapping("/remove")
    public ResponseEntity<Cart> removeItem(@RequestParam(required = false) Long customerId, @RequestParam Long productId) {
        Long cid = resolveCustomerId(customerId);
        return ResponseEntity.ok(cartService.removeItem(cid, productId));
    }

    @PostMapping("/checkout")
    public ResponseEntity<PurchaseOrder> checkout(@RequestParam(required = false) Long customerId) {
        Long cid = resolveCustomerId(customerId);
        PurchaseOrder order = cartService.checkout(cid);
        return ResponseEntity.ok(order);
    }
}
