package com.doordripp.doordripp.service;

import com.doordripp.doordripp.model.*;
import com.doordripp.doordripp.repository.CartRepository;
import com.doordripp.doordripp.repository.ProductRepository;
import com.doordripp.doordripp.repository.CustomerRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.stream.Collectors;
import java.util.List;

@Service
public class CartService {
    private final CartRepository cartRepository;
    private final ProductRepository productRepository;
    private final CustomerRepository customerRepository;
    private final OrderService orderService;

    public CartService(CartRepository cartRepository,
                       ProductRepository productRepository,
                       CustomerRepository customerRepository,
                       OrderService orderService) {
        this.cartRepository = cartRepository;
        this.productRepository = productRepository;
        this.customerRepository = customerRepository;
        this.orderService = orderService;
    }

    public Cart getCartForCustomer(Long customerId) {
        return cartRepository.findByCustomerId(customerId).orElseGet(() -> createCartForCustomer(customerId));
    }

    @SuppressWarnings("null")
	private Cart createCartForCustomer(Long customerId) {
        Customer customer = customerRepository.findById(customerId)
                .orElseThrow(() -> new IllegalArgumentException("Invalid customer"));
        Cart cart = new Cart();
        cart.setCustomer(customer);
        cart.setTotal(BigDecimal.ZERO);
        return cartRepository.save(cart);
    }

    @Transactional
    public Cart addItem(Long customerId, Long productId, int quantity) {
        if (quantity <= 0) throw new IllegalArgumentException("Quantity must be positive");
        Cart cart = getCartForCustomer(customerId);
        @SuppressWarnings("null")
		Product product = productRepository.findById(productId)
                .orElseThrow(() -> new IllegalArgumentException("Invalid product"));

        Optional<CartItem> existing = cart.getItems().stream()
                .filter(i -> i.getProduct().getId().equals(productId))
                .findFirst();

        if (existing.isPresent()) {
            // Do NOT change the existing price snapshot by default; keep original price when incrementing
            CartItem item = existing.get();
            item.setQuantity(item.getQuantity() + quantity);
        } else {
            CartItem item = new CartItem();
            item.setProduct(product);
            item.setQuantity(quantity);
            // snapshot price at the time item was first added
            item.setPrice(product.getPrice());
            // set back-reference so JPA knows owning side
            item.setCart(cart);
            cart.getItems().add(item);
        }

        cart.recalcTotal();
        return cartRepository.save(cart);
    }

    @Transactional
    public Cart removeItem(Long customerId, Long productId) {
        Cart cart = getCartForCustomer(customerId);
        cart.getItems().removeIf(i -> i.getProduct().getId().equals(productId));
        cart.recalcTotal();
        return cartRepository.save(cart);
    }

    @Transactional
    public PurchaseOrder checkout(Long customerId) {
        Cart cart = getCartForCustomer(customerId);
        if (cart.getItems().isEmpty()) throw new IllegalStateException("Cart is empty");

        List<OrderItem> orderItems = cart.getItems().stream().map(ci -> {
            OrderItem oi = new OrderItem();
            oi.setProduct(ci.getProduct());
            oi.setQuantity(ci.getQuantity());
            oi.setPrice(ci.getPrice());
            return oi;
        }).collect(Collectors.toList());

        PurchaseOrder order = orderService.placeOrder(customerId, orderItems);

        // clear cart
        cart.getItems().clear();
        cart.setTotal(BigDecimal.ZERO);
        cartRepository.save(cart);
        return order;
    }

    @SuppressWarnings("unused")
	private void recalcTotal(Cart cart) {
        cart.recalcTotal();
    }
}
