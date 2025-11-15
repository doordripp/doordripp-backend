package com.doordripp.doordripp.controller;

import com.doordripp.doordripp.model.OrderItem;
import com.doordripp.doordripp.model.PurchaseOrder;
import com.doordripp.doordripp.service.OrderService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.util.List;

@RestController
@RequestMapping("/api/orders")
public class OrderController {
    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    @PostMapping
    public ResponseEntity<PurchaseOrder> placeOrder(@RequestParam Long customerId, @RequestBody List<OrderItem> items) {
        PurchaseOrder order = orderService.placeOrder(customerId, items);
        return ResponseEntity.created(URI.create("/api/orders/" + order.getId())).body(order);
    }
}
