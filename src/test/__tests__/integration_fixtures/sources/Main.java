public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, World!");

        String userName = args.length > 0 ? args[0] : "Guest";
        System.out.println("Welcome, " + userName);
    }

    public void processData(String data) {
        if (data == null) {
            throw new IllegalArgumentException("Data cannot be null");
        }
        // Process the data
        System.out.println("Processing: " + data);
    }
}
