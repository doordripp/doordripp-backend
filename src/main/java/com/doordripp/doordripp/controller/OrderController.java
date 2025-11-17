package com.doordripp.doordripp.controller;

import com.doordripp.doordripp.model.OrderItem;
import com.doordripp.doordripp.model.PurchaseOrder;
import com.doordripp.doordripp.service.OrderService;
import lombok.Data;
import org.springframework.http.ResponseEntity;
import org.springframework.http.HttpStatus;
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

    // ---------- Place Order ----------
    @SuppressWarnings("null")
	@PostMapping
    public ResponseEntity<?> placeOrder(@RequestBody OrderRequest request) {
        try {
            PurchaseOrder order = orderService.placeOrder(request.getCustomerId(), request.toOrderItems());
            
            if (order == null || order.getId() == null) {
                return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                        .body("Failed to create order");
            }
            
            return ResponseEntity
                    .created(URI.create("/api/orders/" + order.getId()))
                    .body(order);

        } catch (IllegalStateException e) {
            // Not enough stock or cart errors → 409 Conflict
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(e.getMessage());

        } catch (IllegalArgumentException e) {
            // Invalid input → 400 Bad Request
            return ResponseEntity.badRequest()
                    .body(e.getMessage());
        }
    }
}

// ---------------- DTO ----------------

@Data
class OrderRequest {
    private Long customerId;
    private List<OrderItemDto> items;

    public List<OrderItem> toOrderItems() {
        return items.stream().map(i -> {
            OrderItem oi = new OrderItem();
            oi.setProduct(i.getProduct());   // Product only, order is set in service
            oi.setQuantity(i.getQuantity());
            oi.setPrice(i.getPrice());
            return oi;
        }).toList();
    }
}

@Data
class OrderItemDto {
    private Long productId;
    private int quantity;
    private java.math.BigDecimal price;

    // Create lightweight Product reference
    public com.doordripp.doordripp.model.Product getProduct() {
        com.doordripp.doordripp.model.Product p = new com.doordripp.doordripp.model.Product();
        p.setId(productId);
        return p;
    }
}

