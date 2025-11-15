package com.doordripp.doordripp.controller;

import com.doordripp.doordripp.model.Cart;
import com.doordripp.doordripp.model.PurchaseOrder;
import com.doordripp.doordripp.service.CartService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/cart")
public class CartController {
    private final CartService cartService;

    public CartController(CartService cartService) {
        this.cartService = cartService;
    }

    @GetMapping
    public ResponseEntity<Cart> getCart(@RequestParam Long customerId) {
        return ResponseEntity.ok(cartService.getCartForCustomer(customerId));
    }

    @PostMapping("/add")
    public ResponseEntity<Cart> addItem(@RequestParam Long customerId, @RequestParam Long productId, @RequestParam int quantity) {
        return ResponseEntity.ok(cartService.addItem(customerId, productId, quantity));
    }

    @PostMapping("/remove")
    public ResponseEntity<Cart> removeItem(@RequestParam Long customerId, @RequestParam Long productId) {
        return ResponseEntity.ok(cartService.removeItem(customerId, productId));
    }

    @PostMapping("/checkout")
    public ResponseEntity<PurchaseOrder> checkout(@RequestParam Long customerId) {
        PurchaseOrder order = cartService.checkout(customerId);
        return ResponseEntity.ok(order);
    }
}
