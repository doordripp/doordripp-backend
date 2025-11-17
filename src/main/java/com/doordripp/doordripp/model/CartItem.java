package com.doordripp.doordripp.model;

import jakarta.persistence.*;
import lombok.*;
import com.fasterxml.jackson.annotation.JsonBackReference;

import java.math.BigDecimal;

@Entity
@Table(name = "cart_items")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class CartItem {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // Back-reference to cart (owning side)
    @ManyToOne(optional = false)
    @JoinColumn(name = "cart_id", nullable = false)
    @JsonBackReference  // Prevent circular reference in JSON
    private Cart cart;

    @ManyToOne(optional = false)
    @JoinColumn(name = "product_id", nullable = false)
    private Product product;

    @Column(nullable = false)
    private int quantity;

    // Price snapshot when added to cart
    @Column(nullable = false, precision = 19, scale = 4)
    private BigDecimal price;
}
