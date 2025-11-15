package com.doordripp.doordripp.repository;

import com.doordripp.doordripp.model.PurchaseOrder;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrderRepository extends JpaRepository<PurchaseOrder, Long> {
}
