// controllers/foodController.js

const allFoods = {
    "corba": [
      {
        "isim": "Mercimek Çorbası",
        "image": "/assets/mercimek.jpg",
        "fiyat": 70
      },
      {
        "isim": "Ezogelin Çorbası",
        "image": "/assets/ezogelin.jpg",
        "fiyat": 80
      },
      {
        "isim": "Tavuk Suyu Çorbası",
        "image": "/assets/tavuk-suyu.jpeg",
        "fiyat": 95
      }
    ],
    "anaYemek": [
      {
        "isim": "Fırın Tavuk",
        "image": "/assets/firintavuk.jpg",
        "fiyat": 230
      },
      {
        "isim": "Kuru Fasulye",
        "image": "/assets/kurufasulye.jpg",
        "fiyat": 170
      },
      {
        "isim": "Salçalı Köfte",
        "image": "/assets/salcalikofte.jpg",
        "fiyat": 250
      },
      {
        "isim": "Patlıcan Musakka",
        "image": "/assets/patlicanmusakka.jpg",
        "fiyat": 260
      },
      {
        "isim": "Çıtır Tavuk",
        "image": "/assets/citirtavuk.jpg",
        "fiyat": 240
      },
      {
        "isim": "Hasanpaşa Köfte",
        "image": "/assets/hasanpasa.jpg",
        "fiyat": 270
      },
      {
        "isim": "Terbiyeli Köfte",
        "image": "/assets/terbiyelikofte.jpg",
        "fiyat": 220
      },
      {
        "isim": "Kıymalı Çökertme Kebabı",
        "image": "/assets/kıymalıcokertme.jpg",
        "fiyat": 250
      },
      {
        "isim": "Sebzeli Kıymalı Patlıcan Yemeği",
        "image": "/assets/sebzelikiymalipatlican.jpg",
        "fiyat": 230
      },
      {
        "isim": "Nohut",
        "image": "/assets/nohut.jpg",
        "fiyat": 180
      },
      {
        "isim": "Sebzeli Tavuk",
        "image": "/assets/sebzelitavuk.jpg",
        "fiyat": 220
      },
      {
        "isim": "Beşamel Soslu Kıymalı Patates",
        "image": "/assets/besamelsoslukiymali.jpg",
        "fiyat": 240
      },
      {
        "isim": "Beşamel Soslu Tavuk",
        "image": "/assets/besamelsoslutavuk.jpg",
        "fiyat": 210
      },
      {
        "isim": "Karnıyarık",
        "image": "/assets/karnıyarık.jpg",
        "fiyat": 250
      },
      {
        "isim": "Kıymalı Ekmek Kebabı",
        "image": "/assets/kıymalıekmekkebabı.jpg",
        "fiyat": 240
      },
      {
        "isim": "Patates Oturtma",
        "image": "/assets/patatesoturtma.jpg",
        "fiyat": 220
      },
      {
        "isim": "Tavuk Tandık",
        "image": "/assets/tavuktandır.jpg",
        "fiyat": 260
      }
    ],
    "eslikci": [
      {
        "isim": "Pirinç Pilavı",
        "image": "/assets/pirincpilavi.jpg",
        "fiyat": 110
      },
      {
        "isim": "Soslu Mantı",
        "image": "/assets/soslumanti.jpg",
        "fiyat": 150
      },
      {
        "isim": "Bulgur Pilavı",
        "image": "/assets/bulgurpilavi.jpg",
        "fiyat": 100
      },
      {
        "isim": "Soslu Spagetti",
        "image": "/assets/sosluspagetti.jpg",
        "fiyat": 130
      },
      {
        "isim": "Soslu Makarna",
        "image": "/assets/soslumakarna.jpg",
        "fiyat": 120
      }
    ],
    "soguk": [
      {
        "isim": "Çoban Salata",
        "image": "/assets/coban-salata.jpg",
        "fiyat": 60
      },
      {
        "isim": "Mevsim Salata",
        "image": "/assets/mevsim-salata.jpg",
        "fiyat": 50
      },
      {
        "isim": "Yoğurt",
        "image": "/assets/yogurt.jpg",
        "fiyat": 50
      },
      {
        "isim": "Cacık",
        "image": "/assets/cacık.jpg",
        "fiyat": 80
      }
    ],
    "tatli": [
      {
        "isim": "Tiramisu",
        "image": "/assets/tiramisu.jpg",
        "fiyat": 140
      },
      {
        "isim": "Kemalpaşa Tatlısı",
        "image": "/assets/kemalpasa.jpg",
        "fiyat": 120
      },
      {
        "isim": "Süt Helvası",
        "image": "/assets/suthelvasi.jpg",
        "fiyat": 150
      },
      {
        "isim": "Çikolata Soslu Etimek",
        "image": "/assets/cikolatasosluetimek.jpg",
        "fiyat": 100
      },
      {
        "isim": "İrmik Helvası",
        "image": "/assets/irmikhelvasi.jpg",
        "fiyat": 110
      },
      {
        "isim": "Bisküvili Pasta",
        "image": "/assets/biskuvipasta.jpg",
        "fiyat": 100
      },
      {
        "isim": "Portakallı Revani",
        "image": "/assets/portakallirevani.jpg",
        "fiyat": 120
      },
      {
        "isim": "Yer Fıstıklı Çıtır Muhallebi",
        "image": "/assets/fistiklimuhallebi.jpg",
        "fiyat": 140
      },
      {
        "isim": "Supangle",
        "image": "/assets/supangle.jpg",
        "fiyat": 130
      }
    ]
};

exports.getAllFoods = (req, res) => {
  res.json(allFoods);
};