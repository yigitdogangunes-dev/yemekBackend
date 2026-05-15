const PricingTier = require("../models/PricingTier");

exports.getPricingTiers = async (req, res) => {
  try {
    const tiers = await PricingTier.find().sort({ itemCount: 1 });
    res.json(tiers);
  } catch (error) {
    res.status(500).json({ message: "Error fetching pricing tiers", error: error.message });
  }
};

exports.updatePricingTier = async (req, res) => {
  try {
    const { id } = req.params;
    const { packagePrice } = req.body;
    
    const updatedTier = await PricingTier.findByIdAndUpdate(
      id,
      { packagePrice },
      { new: true, runValidators: true }
    );
    
    if (!updatedTier) return res.status(404).json({ message: "Paket bulunamadı" });
    
    res.json(updatedTier);
  } catch (error) {
    res.status(400).json({ message: "Güncelleme hatası", error: error.message });
  }
};
