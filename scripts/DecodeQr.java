import java.awt.image.BufferedImage;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import javax.imageio.ImageIO;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;

/** Verify the Android scanner's decoder against a real Go-generated login QR. */
public final class DecodeQr {
    public static void main(String[] args) throws Exception {
        BufferedImage image=ImageIO.read(new File(args[0]));
        int width=image.getWidth(),height=image.getHeight();
        int[] pixels=image.getRGB(0,0,width,height,null,0,width);
        String actual=new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(width,height,pixels)))).getText();
        String expected=Files.readString(Path.of(args[1])).trim();
        if(!actual.equals(expected))throw new AssertionError("Login QR decoder mismatch");
        System.out.println("Go QR image decoded by Android ZXing decoder: OK");
    }
}
