package com.doordripp.doordripp.repository;

import com.doordripp.doordripp.model.Product;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProductRepository extends JpaRepository<Product, Long> {
}
